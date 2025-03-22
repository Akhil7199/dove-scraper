const { app, Tray, Menu } = require('electron');
const { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } = require('fs');
const { resolve } = require('path');
const { launch } = require('puppeteer-core');
const { createTransport } = require('nodemailer');
const { exec } = require('child_process');
const get = require('node-fetch');

const r = (i) => i.toString().padStart(2, '0');

app.on('ready', () => {
    new Taskbar();
    Monitor.start();
   global.log('Electron App is ready');
});

const cfg = (() => {
    const join = (path, root) => resolve(root ?? app.getPath('userData'), path);
    const configPath = join('./config.json');
    const defaultConfigPath = join('./_config.json', __dirname);
    console.log(configPath);

    if (!existsSync(configPath)) {
        const temp = JSON.parse(readFileSync(defaultConfigPath, 'utf8'));
        writeFileSync(configPath, JSON.stringify(temp, null, 4));
        return temp;
    }

    try {
        return JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
        const temp = JSON.parse(readFileSync(defaultConfigPath, 'utf8'));
        writeFileSync(configPath, JSON.stringify(temp, null, 4));
        return temp;
    }
})();

const find = (path, type) => {
    const join = (path, root) => resolve(root ?? app.getPath('userData'), path);
    if (type === 1) {

        // Check if directory exists, if not create it.
        if (!existsSync(join(path))) {
            return mkdirSync(join(path), { recursive: true });
        }
    } else {
        if (path && path?.startsWith('%APPDATA%')) {
            return path.replace(/%APPDATA%/g, app.getPath('appData'))
        } else {
            return join(path);
        }
    }
}

console.log(`SMTP Host: ${cfg.smtp.host}, From: ${cfg.smtp.from}, To: ${cfg.smtp.to}`);

const manager = JSON.parse(readFileSync(find(cfg.manager.config), 'utf8'));
const scraper = JSON.parse(readFileSync(find(cfg.scraper.config), 'utf8'));

find(cfg.logs.path, 1);

if (!existsSync(find(`${cfg.logs.path}/${cfg.logs.file}`))) writeFileSync(find(`${cfg.logs.path}/${cfg.logs.file}`), '');
const logStream = cfg.logs.enabled ? createWriteStream(find(`${cfg.logs.path}/${cfg.logs.file}`), { flags: 'a' }) : void 0;
global.log = msg => cfg.logs.enabled ? logStream.write(`[${new Date().toLocaleString('en-US', { timeZone: cfg.timezone })}] ${msg}\n`) : void 0;

app.on('ready', () => new Taskbar()).on('quit', process.exit);

app.requestSingleInstanceLock();

function quitHandler() {
    Monitor.stop();

    global.tray?.destroy();

    app.emit('quit');
}

/**
 * Function to open a path from the tray.
 * 
 * @param {string} path The path to open. 
 * @return {null}
 */
function open(path) {
    log(`Opening ${find(typeof path === 'string' ? path : './')} from tray...`)
    exec(`start "" "${find(typeof path === 'string' ? path : './')}"`);
}

class Taskbar {
    constructor() {
        global.tray = new Tray(resolve(__dirname, './icon.png'));
        global.tray.setToolTip('Dove Monitor');
        Taskbar.refresh();
        new Monitor();
    }

    static refresh() {
        global.tray.setContextMenu(Menu.buildFromTemplate([
            { label: Monitor.active ? '\uD83D\uDFE2 Active' : '\uD83D\uDD34 Inactive', click: Monitor.toggle },
            { label: 'Open Config', click: () => open('config.json'), },
            { label: 'Open Logs', click: () => open(cfg.logs.path), },
            { label: 'Open AppData', click: open, },
            { label: '\uD83D\uDD25 Quit', click: quitHandler },
        ]));
    }
}


async function ping(server, url) {
    console.log(`Pinging ${url ? url : `http://${server.ip}:${server.port}${server.status}`}`);
    const response = await get(url ? url : `http${server.https ? 's' : ''}://${server.ip}:${server.port}${server.status}`).catch(e => {
        console.log(`Ping failed for ${server.ip}: ${e}`);
        return e;
    });
    if (response instanceof Error) {
        global.log(`Service at ${server.ip} is down.`);
    } else {
        global.log(`Service at ${server.ip} is up.`);
    }
    return response;
 }


class Monitor {

    static active = false;
    static intervals = null;

    static start() {
        Monitor.active = true;
        Monitor.trigger();
        Monitor.intervals = setInterval(Monitor.trigger, cfg.interval)
    }

    static async trigger() {
        try {
            const errors = {};
            errors.manager = await Monitor.manager();
            errors.scraper = await Monitor.scraper();
            global.log(errors); // Log the current errors object for debugging
            if (errors.manager !== true || errors.scraper.length > 0) {
                global.log("Attempting to send an email due to service down...");
                await Monitor.sendEmail(errors);
            }
        } catch (error) {
            global.log(`An error occurred during monitoring: ${error}`);
        }
     }
    static stop() {
        Monitor.active = false;
        clearInterval(Monitor.intervals);
    }

    static toggle() {
        Monitor[Monitor.active ? 'stop' : 'start']();
        Taskbar.refresh();
    }

    static async manager() {
        const result = await ping({
            ip: 'localhost',
            port: manager.endpoint.port,
            https: false,
            status: manager.endpoint.status,
        });
        return result instanceof Error ? result.message : true
    }

    static async scraper() {
        const down = [];

        for await (const server of manager.servers) {
            const result = await ping(server);
            if (result instanceof Error) {
                log(`[ERROR] Server ${server.ip} is not usable. ${result}`);
                down.push({
                    server,
                    error: result.message,
                });
            }
        }
        return down;
    }

    static async dovehttps() {
        const result = await ping(void 0, scraper.login.url);
        return result instanceof Error ? result.message : true
    }

    static async doveprocessor() {
        try {

            // Open a browser instance.
            browser = await launch({
                headless: false, //$HEADLESS,
                executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            });
            log(`Browser instance opened.`);
            page = await browser.newPage();
            log(`New page opened.`);

            // Login to site.
            await page.goto(scraper.login.url, { waitUntil: 'networkidle2' });
            log(`Opened url ${scraper.login.url}.`);
            await page.evaluate(data => {
                const input = document.querySelectorAll('input');
                input[0].value = data.username;
                input[1].value = data.password;
            }, scraper.login);
            log(`Filled out login form.`);
            await page.click('.button');
            await page.waitForNetworkIdle();

            await page.evaluate(data => {
                function fix(date) {
                    const zero = num => +num < 32 ? (+num < 10 ? `0${+num}` : num) : num;
                    return date.split('/').map(zero).join('/');
                }
                const input = document.querySelectorAll('input');
                input[3].value = data.SSN;
                input[4].click();
                input[5].click();
                input[6].click();
                input[7].value = data.FirstName;
                input[9].value = data.LastName;
                input[13].value = fix(data.DOB);
            }, data);
            log(`Filled out form.`);
            await page.click('#SubmitButton');
            await page.waitForNetworkIdle();
            log(`Form submitted, waiting for results.`);

            await browser.close();
            return true
        } catch (e) {
            log(`[ERROR] ${e}`);
            return e.message
        }
    }

    static async apim() {
        const result = await ping(void 0, scraper.post.url);
        return result instanceof Error ? result.message : true
    }

    static async sendEmail(errors) {
        global.log("SendEmail function called");
        // Set up the transporter for sending the email.
        const sender = createTransport({
            host: cfg.smtp.host,
            port: cfg.smtp.port,
            secure: cfg.smtp.secure, // Note: `secure` is true if port is 465
            requireTLS: cfg.smtp.requireTLS,
            auth: {
                user: cfg.smtp.username, // SMTP username from your config (if authentication is needed)
                pass: cfg.smtp.password // SMTP password from your config (if authentication is needed)
            }
        });
        // Read and prepare the HTML template.
        const htmlTemplate = readFileSync(find('./template.html', __dirname), 'utf8');
        const formatValue = (value) => `<monospace style="font-family: monospace;font-weight: bold;padding: 0 3px;background: #c0c0c0;border-radius: 3px;">${value}</monospace>`;
        // Replace placeholders in the HTML template with actual values.
        const emailHtml = htmlTemplate
            .replace(/{{DATETIME}}/g, new Date().toLocaleString().replace(/\d{1,2}:\d{2}(?=:)/g, (i) => r(i)))
            .replace(/{{MANAGER}}/g, formatValue(errors.manager === true ? 'Online' : 'Service Down'))
            .replace(/{{SCRAPER}}/g, formatValue(errors.scraper.length === 0 ? 'Online' : errors.scraper.map(i => `${i.server.ip} - ${i.error}`).join('<br>')))
            .replace(/{{DOVEHTTPS}}/g, formatValue(errors.dovehttps === true ? 'Online' : 'Service Down'))
            .replace(/{{DOVEPROCESSOR}}/g, formatValue(errors.doveprocessor === true ? 'Online' : 'Service Down'))
            .replace(/{{APIM}}/g, formatValue(errors.apim === true ? 'Online' : 'Service Down'));
        // Send the email.
        try {
            const info = await sender.sendMail({
                from: cfg.smtp.from, // Sender address
                to: cfg.smtp.to, // List of recipients
                subject: cfg.smtp.subject, // Subject line
                html: emailHtml // HTML body content
            });
            global.log('Email sent Successfully: ' + info.response);
        } catch (error) {
            global.log('Error sending email: ' + error.message);
        }
     }
}
