/**
 * @note This application is designed to be a background service, and will not have a GUI.
 * 
 * @note Please do not modify the _config.json file unless you know what you are doing!!
 * 
 * @note Any modifiable data will be located at C:\Users\<USER>\AppData\Roaming\scraper.
 * 
 * @note This application will only work on Windows systems.
 * 
 * @note Please refer to the package.json scripts to run the application.
 * 
 * @author rsingh3
 */

// Import electron, this library will assist in converting the application to a background service and package to an exe.
const { app, Tray, Menu: { buildFromTemplate } } = require('electron');

// Import fs, to manage system files.
const { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, mkdirSync, createWriteStream } = require('fs');

// Import path, to manage system paths.
const { resolve } = require('path');

// Import puppeteer, this library will do the action of web-scraping for the necessary data.
const { launch } = require('puppeteer-core');

// Import express, this library will initialize and control the rest serivces of this application.
const express = require('express');

// Import cron, to prevent request outside of regular timings of 0700-1900 EST.
const cron = require('node-cron');

// Import chokidar, to watch for new files.
const chokidar = require('chokidar');

// Import node-fetch, to make a POST request.
const get = require('node-fetch');

// Import child_process, to open system paths.
const { exec } = require('child_process');

/**
 * Function to find a file or directory using varying parameters.
 * 
 * @param {string} path The path to the file or directory.
 * @param {number} type A type number of what kind of file to process.
 * @returns {string | object} Returns a string or object depending on the type.
 */
const find = (path, type) => {
    const join = (path, root) => resolve(root ?? app.getPath('userData'), path);
    if (type === 0) {

        // Check if config file exists, if not create it.
        if (!existsSync(join('./config.json'))) {
            const temp = JSON.parse(readFileSync(join('./_config.json', __dirname), 'utf8'));
            writeFileSync(join('./config.json'), JSON.stringify(temp, null, 4));
            return temp;
        } else {
            let temp = void 0;

            // Try catch for if the config file is corrupted and needs to be replaced.
            try {
                temp = JSON.parse(readFileSync(join('./config.json'), 'utf8'));
            } catch (e) {
                temp = JSON.parse(readFileSync(join('./_config.json', __dirname), 'utf8'));
                writeFileSync(join('./config.json'), JSON.stringify(temp, null, 4));
                return JSON.parse(readFileSync(join('./config.json'), 'utf8'));
            }
            return temp;
        }
    } else if (type === 1) {

        // Check if directory exists, if not create it.
        if (!existsSync(join(path))) {
            return mkdirSync(join(path), { recursive: true })
        }
    } else {

        // This one is to just find the path to accepted incoming files from the rest service.
        return join(path);
    }
}

// Static data for the application to use.
const cfg = find(void 0, 0);
let instances = 0;

const [
    $ENDPOINT,
    $PATH,
    $LOGIN,
    $POST,
    $CRON,
    $DEBUG,
    $HEADLESS,
    $MAX,
] = [
        cfg.endpoint,
        cfg.paths,
        cfg.login,
        cfg.post,
        cfg.cron,
        cfg.debug,
        cfg.headless,
        cfg.instances,
    ];

// Make sure all required directories exist.
find($PATH.posted, 1);
find($PATH.incoming, 1);
find($PATH.processed, 1);
find($PATH.logs.path, 1);
if ($DEBUG) find($PATH.debug, 1);

global.active = false;
if (!existsSync(find(`${$PATH.logs.path}/${$PATH.logs.file}`))) writeFileSync(find(`${$PATH.logs.path}/${$PATH.logs.file}`), '');
let logStream = $PATH.logs.enabled ? createWriteStream(find(`${$PATH.logs.path}/${$PATH.logs.file}`), { flags: 'a' }) : void 0;
global.log = msg => $PATH.logs.enabled ? logStream.write(`[${new Date().toLocaleString('en-US', { timeZone: $CRON.timezone })}] ${msg}\n`) : void 0;

// Handle uncaught exceptions.
process.on('unhandledRejection', error => {
    log(`[ERROR] Uncaught exception: ${error}\n${error.stack}`);
    if (cfg.errors) throw error;
});

// !!! APP STARTS HERE !!!
// App events, on ready start a taskbar icon, and on quit make sure the process exits.
log(`Starting application (v${app.getVersion()}).`);
app.on('ready', () => new Taskbar()).on('quit', process.exit);

// Request that the app only be opened once, so it won't cause issues when opened twice.
app.requestSingleInstanceLock();

/**
 * Handles the application exiting.
 * 
 * @param {null}
 * @return {null}
 */
function quitHandler() {

    // Stop listening for files.
    Scraper.quit();

    // Quit tray application.
    global.tray?.destroy();
    log(`Tray icon destroyed.`);

    // Quit cron jobs.
    global.manager.quit();

    // Quit electron application.
    log(`Quitting application.`);
    logStream.end();
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

// Class to manage Taskbar.
class Taskbar {
    constructor() {

        // Start application.
        new Main()

        // Start tray icon.
        global.tray = new Tray(resolve(__dirname, './icon.png'));
        global.tray.setToolTip('DOVE Scraper');
        log('Tray icon initialized.');

        // Give it functionality.
        global.tray.setContextMenu(buildFromTemplate([
            { label: 'Open Config', click: () => open('config.json'), },
            { label: 'Open Logs', click: () => open($PATH.logs.path), },
            { label: 'Open AppData', click: open, },
            { label: 'Quit', click: quitHandler },
            { label: 'Manual', click: () => Scraper.wakeup() },
            { label: `v${app.getVersion()}` }
        ]));
    }
}

// Application start logic.
class Main {
    constructor() {
        global.manager = new Manager();
        this.service();
        Scraper.listen();
    }

    /**
     * Start the express rest service.
     * 
     * @param {null}
     * @return {null}
     */
    service() {
        express()

            // This allows us to be able to read incoming data.
            .use(express.json())

            .get($ENDPOINT.ping, (req, res) => {
                log(`New status check at ${$ENDPOINT.ping} from ${req.ip.match(/(\d{1,3}\.?){4}/g)?.[0]}.`);
                const incoming = readdirSync(find($PATH.incoming)).length;
                res.status(418).json({ message: 'I\'m a teapot.', incoming });
            })

            // A status endpoint to check if the service is running.
            .get($ENDPOINT.status, (req, res) => {
                log(`New request at ${$ENDPOINT.status} from ${req.ip.match(/(\d{1,3}\.?){4}/g)?.[0]}.`);
                res.status(200).json({ online: !0 });
            })

            // The service endpoint all incoming data will be sent to.
            .post($ENDPOINT.service, (req, res) => {
                log(`New request at ${$ENDPOINT.service} from ${req.ip.match(/(\d{1,3}\.?){4}/g)?.[0]}.`);

                // No data found.
                if (!req.body.MemberData?.length || !req.body.CaseNumber) {
                    const content = {
                        code: 400,
                        status: 'failure',
                        message: 'Not all required fields found.',
                        data: { missing: [!req.body.CaseNumber ? 'CaseNumber' : 'MemberData'] }
                    };
                    log(`Request from ${req.ip} failed with code 400.\n${JSON.stringify(content, null, 4)}`)
                    return res.status(400).json(content);
                }

                // Check if all required fields exist, else send 400 code with message.
                const failed = [];

                // Check if all required data exists.
                for (let i = 1; i <= req.body.MemberData.length; i++) {
                    const missing = [];
                    const fix = str => {
                        if (str.startsWith('-')) str = str.slice(1);
                        if (str.endsWith('-')) str = str.slice(0, -1);
                        return str;
                    }
                    req.body.MemberData[i - 1].FirstName = fix(req.body.MemberData[i - 1].FirstName.replace(/\d.*|\.|\'|\*/g, ''));
                    req.body.MemberData[i - 1].LastName = fix(req.body.MemberData[i - 1].LastName.replace(/\d.*|\.|\'|\*/g, ''));
                    for (const field of ['MemberID', 'SSN', 'FirstName', 'LastName', 'DOB']) {
                        const set = req.body.MemberData[i - 1][field];
                        if (!set) missing.push(field);
                        else {

                            if (field === 'SSN' && set.length !== 9) missing.push('SSN is not the correct length.');
                            if (field === 'DOB' && set.length !== 8) missing.push('DOB is not the correct length. (Zero padding is required).');
                            else if (field === 'DOB' && parseInt(set.slice(0, 4)) < 1900) missing.push('DOB must be greater than 1900.');
                            else if (field === 'DOB' && parseInt(set.slice(4, 6)) > 12) missing.push('DOB Month is invalid.');
                            else if (field === 'DOB' && parseInt(set.slice(6, 8)) > 31) missing.push('DOB Day is invalid.');
                        }
                    }
                    if (missing.length) failed.push({ set: i, missing });
                }

                // If data is missing, reject request.
                if (failed.length) {
                    const content = {
                        code: 400,
                        status: 'failure',
                        message: 'Not all required fields found.',
                        data: failed,
                    };
                    log(`Request from ${req.ip} failed with code 400.\n${JSON.stringify(content, null, 4)}`);
                    return res.status(400).json(content);
                }

                const id = `${Date.now()}.json`;
                const content = {
                    code: 200,
                    status: 'success',
                    message: `Your request was accepted and will be processed ${global.active ? 'shortly' : 'after 0700 EST'}.`,
                }

                // Write data to file, write with current time MS as a snowflake.
                log(`Request from ${req.ip} succeeded, writing to file ${find(`${$PATH.incoming}/${id}`)}.`);

                writeFileSync(find(`${$PATH.incoming}/${id}`), JSON.stringify(req.body));

                // Send message so user knows we got their request.
                log(`Request from ${req.ip} succeeded with code 200.\n${JSON.stringify(content, null, 4)}`);
                return res.status(200).json(content);
            })

            // The port to listen on.
            .listen($ENDPOINT.port, () => log('Rest service active.'));
    }
}

// Make sure no scraping happens outside of working hours.
class Manager {

    open = void 0;
    close = void 0;
    logs = void 0;

    constructor() {

        // Allow scraping to start after 0700 EST.
        this.open = cron.schedule($CRON.open, () => {
            global.active = true;
            log(`Cron job started at ${$CRON.open}.\nCalling Scraper to process any files that were sent during the night.`);
            // Call wakeup to process any files that were sent during the night.
            Scraper.wakeup();
        }, {
            scheduled: true,
            timezone: $CRON.timezone
        });

        // Stop scraping after 1900 EST.
        this.close = cron.schedule($CRON.close, () => {
            global.active = false;
            log(`Cron job started at ${$CRON.close}.\nStopping Scraper from processing any files that were sent during the day.`);
        }, {
            scheduled: true,
            timezone: $CRON.timezone
        });

        this.logs = cron.schedule($CRON.logs, () => {
            const temp = $PATH.logs.enabled;
            $PATH.logs.enabled = false;
            logStream.end();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const [year, month, day] = [yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate()];
            renameSync(find(`${$PATH.logs.path}/${$PATH.logs.file}`), find(`${$PATH.logs.path}/${$PATH.logs.file.split('.').shift()}-${month}-${day}-${year}.log`));
            writeFileSync(find(`${$PATH.logs.path}/${$PATH.logs.file}`), '');
            $PATH.logs.enabled = temp;
            logStream = $PATH.logs.enabled ? createWriteStream(find(`${$PATH.logs.path}/${$PATH.logs.file}`), { flags: 'a' }) : void 0;
        }, {
            scheduled: true,
            timezone: $CRON.timezone
        });

        log(`Cron jobs initialized at ${$CRON.open} and ${$CRON.close}.`)
        // Start cron jobs.
        this.open.start();
        this.close.start();
        this.logs.start();

        // Check the current time.
        this.checkCurrent();
    }

    /**
     * Function to stop cron jobs.
     * 
     * @param {null}
     * @return {null}
     */
    quit() {
        log(`Stopping cron jobs.`);
        this.open.stop();
        this.close.stop();
        this.logs.stop();
    }

    /**
     * Check the current time and set the global active variable.
     * 
     * @param {null}
     * @return {null}
     */
    checkCurrent() {
        log(`Checking current time to see if scraper should be active.`)
        const current = new Date(new Date().toLocaleString('en-US', { timeZone: $CRON.timezone })).getHours();
        if (current >= parseInt($CRON.open.split(' ')[1]) && current < parseInt($CRON.close.split(' ')[1])) {
            global.active = true;
            log(`Scraper is set to active.`);
        } else {
            global.active = false;
            log(`Scraper is set to inactive.`);
        }
    }
}

/**
 *                    ==> Debug Options <==
 * 
 * @format [msDate]-[type].png
 * @type {raw} The incoming data needed to populate the form.
 * @type {open} When the browser first opens and the website is loaded.
 * @type {info} Before the login button is clicked.
 * @type {login} After the login button is clicked.
 * @type {populate} After the form is populated with the data.
 * @type {full} After the full data page is loaded.
 * @type {logout} After the logout button is clicked.
 * @type {data} After the data is processed and ready to be sent.
 * @type {response} After the response is received from the server.
 */

// Scraper logic.
class Scraper {

    static files = [];

    async start(path) {
        if (Scraper.files.includes(path) || !existsSync(find(path))) return log(`Scraper was called on already processed file, skipping...`);
        instances++;
        Scraper.files.push(path);
        log(`Scraper triggered to process file at at ${path}.`);
        log(`Currently working with ${instances} instance(s).\n${Scraper.files.join('\n')}`);
        const data = JSON.parse(readFileSync(path, 'utf8'));
        const l = data.MemberData.length;
        const CaseNumber = data.CaseNumber;
        const id = `${Date.now()}-${CaseNumber}`;
        if ($DEBUG) {

            // Create debug folder.
            log(`[DEBUG] creating debug folder at ${find(`${$PATH.debug}/${id}`)}.`);
            mkdirSync(find(`${$PATH.debug}/${id}`), { recursive: true });

            // Write raw data to file.
            log(`[DEBUG] writing raw data to ${find(`${$PATH.debug}/${id}/${Date.now()}-raw.json`)}.`);
            writeFileSync(find(`${$PATH.debug}/${id}/${Date.now()}-raw.json`), JSON.stringify(data, null, 4));
        }
        process(data.MemberData, true, void 0, void 0, { CaseNumber, MemberData: [] });
        async function process(d, first, p, b, r) {
            if (!d.length) {
                instances--;
                Scraper.files = Scraper.files.filter(e => e !== path);
                Scraper.wakeup(true);
                return;
            }
            const index = l - d.length;
            const next = d.shift();
            next.DOB = `${next.DOB.slice(4, 6)}/${next.DOB.slice(6, 8)}/${next.DOB.slice(0, 4)}`;
            log(`Processing record ${index} of ${l}... (ID: ${id})`);
            const [page, browser, raw] = await new Scraper().scrape({ CaseNumber, ...next }, (first && !d.length) ? 5 : (first ? 0 : (!d.length ? 1 : 2)), path.split('\\')?.pop(), p, b, id, index, r);
            return process(d, void 0, page, browser, raw);
        }
    }

    /**
     * Watch for new files to process in the incoming folder path.
     * 
     * @param {null}
     * @return {null}
     */
    static listen() {
        global.watcher = chokidar.watch(find($PATH.incoming), { persistent: !0 });
        global.watcher.on('add', path => {
            if (global.active) {
                if (instances >= $MAX) return log(`New file detected at ${path}. Scraper will not be called due to max instances.`);
                log(`New file detected at ${path}. Calling Scraper to process NOW.`);
                new Scraper().start(path);
            } else {
                log(`New file detected at ${path}. Scraper will not be called.`);
            }
        });
        log(`File watcher initialized at ${find($PATH.incoming)}.`);
    }

    /**
     * Safely shut down watcher on program exit.
     * 
     * @param {null}
     * @return {null}
     */
    static quit() {
        global.watcher.close();
        log(`File watcher stopped.`);
    }

    /**
     * Tells the scraper to get all requests from outside of working hours to process in the morning.
     * 
     * @param {null}
     * @returns {null}
     */
    static wakeup(local) {

        log(local ? `Local wakeup triggered, checking files.` : `Scraper wakeup triggered, will start processing files now.`);

        // Get all files.
        const files = readdirSync(find($PATH.incoming));

        // Process each file one after another.
        init(files);
        async function init(files) {
            if (!files.length || instances >= $MAX) return;
            if (Scraper.files.includes(find(`${$PATH.incoming}/${files.shift()}`))) files.shift();
            await new Scraper().start(find(`${$PATH.incoming}/${files.shift()}`));
            log(local ? `Processing due to local request.` : (`Processed overnight file, ${files.length ? 'calling Scraper to process next file' : 'Scraper will not be called'}.`));
            return init(files);
        }
    }

    /**
     * Scraper main logic.
     * 
     * @param {object} data The user data to process including CaseNumber, SSN, FirstName, LastName, and DOB.
     * @param {number} id An internal ID to control first and last loop occurences.
     * @param {string} file The file name for post-processing purposes.
     * @param {object} page The page object to interact with.
     * @param {object} browser The browser object to interact with.
     * @param {string} uuid The unique ID for the current request.
     * @return {null} 
     */
    async scrape(data, id, file, page, browser, uuid, index, result) {

        log(`Scraper called with ID ${id}.`);

        try {

            // ID 0 > When the scraper runs the first time.
            if ([0, 3, 5].includes(id)) {
                // Open a browser instance.
                browser = await launch({
                    headless: $HEADLESS,
                    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                });
                log(`Browser instance opened.`);
                page = await browser.newPage();
                log(`New page opened.`);

                // Login to site.
                await page.goto($LOGIN.url, { waitUntil: 'networkidle2' });
                log(`Opened url ${$LOGIN.url}.`);
                if ($DEBUG) {
                    const file = `${Date.now()}-open.png`;
                    log(`[DEBUG] writing type 'open' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
                    await page.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
                }
                await page.evaluate(data => {
                    const input = document.querySelectorAll('input');
                    input[0].value = data.username;
                    input[1].value = data.password;
                }, $LOGIN);
                log(`Filled out login form.`);
                if ($DEBUG) {
                    const file = `${Date.now()}-info.png`;
                    log(`[DEBUG] writing type 'info' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
                    await page.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
                }
                await page.click('.button');
                await page.waitForNetworkIdle();
                if ($DEBUG) {
                    const file = `${Date.now()}-login.png`;
                    log(`[DEBUG] writing type 'login' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
                    await page.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
                }
            }

            // Fill out form and process data.
            if ([0, 1, 2, 5].includes(id)) {
                log(`Calling sub-process to fill out form and process data.`);

                await this.process(data, file, id, page, browser, uuid, index, result);
            }

            // ID 1 > When all data is processed and the browser can be closed.
            if ([1, 4, 5].includes(id)) {

                log(`Scraper finished processing data, logging out.`);
                // Click logout button.
                await page.click('input');
                await page.waitForNetworkIdle();
                if ($DEBUG) {
                    const file = `${Date.now()}-logout.png`;
                    log(`[DEBUG] writing type 'logout' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
                    await page.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
                }

                // Close browser.
                await browser.close();
                log(`Browser instance closed.`);
            }

            if ([1, 5].includes(id)) {

                // Send finalized data.
                log('Sending finalized data to server.');
                await this.post(file, result, id, uuid);
            }

            return [page, browser, result];

        } catch (e) {
            log(`[ERROR] Error in catch all block.`)
            log(`[ERROR] Most recent request with the following data caused an error, please verify data and try again.\n${JSON.stringify(data, null, 4)}`);
            log(`[INFRM] Restarting the browser and moving on due to previously failed scrape.`);

            log(`Moving file ${find(`${$PATH.incoming}/${file}`)} to ${find(`${$PATH.failed}/${file}`)}.`);
            renameSync(find(`${$PATH.incoming}/${file}`), find(`${$PATH.failed}/${file}`));
            await this.scrape(void 0, 4);
            await this.scrape(void 0, 3);
            return;
        }
    }

    /**
     * Fill out form and scrape the necessary data.
     * 
     * @param {object} data The user data to process including CaseNumber, SSN, FirstName, LastName, and DOB.
     * @param {string} file The file name for post-processing purposes.
     * @param {number} id An internal ID to control first and last loop occurences.
     * @param {object} page The page object to interact with.
     * @param {object} browser The browser object to interact with.
     * @param {string} uuid The unique ID for the current request.
     * @return {null}
     */
    async process(data, file, id, page, browser, uuid, index, result) {
        // Populate fields for search.

        log(`Sub-process called to fill out form and process data.`);
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
        if ($DEBUG) {
            const file = `${Date.now()}-populate.png`;
            log(`[DEBUG] writing type 'populate' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
            await page.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
        }
        await page.click('#SubmitButton');
        await page.waitForNetworkIdle();
        log(`Form submitted, waiting for results.`);

        // Open full data page.
        try {
            log(`Opening full data page.`);
            await page.click('div:last-child table:last-child tr:last-child td:last-child input');
        } catch {
            log(`[ERROR] Most recent request with the following data caused an error, please verify data and try again.\n${JSON.stringify(data, null, 4)}`);
            log(`[INFRM] Restarting the browser and moving on due to previously failed scrape.`);

            log(`Moving file ${find(`${$PATH.incoming}/${file}`)} to ${find(`${$PATH.failed}/${file}`)}.`);
            renameSync(find(`${$PATH.incoming}/${file}`), find(`${$PATH.failed}/${file}`));
            await this.scrape(void 0, 4);
            await this.scrape(void 0, 3);
            return;
        }

        // Get new window page.
        const getNewPageWhenLoaded = async () => new Promise(x =>
            browser.on('targetcreated', async target => {
                if (target.type() === 'page') {
                    const newPage = await target.page();
                    const newPagePromise = new Promise(y => newPage.once('domcontentloaded', () => y(newPage)));
                    const isPageLoaded = await newPage.evaluate(() => document.readyState);
                    return isPageLoaded.match('complete|interactive') ? x(newPage) : x(newPagePromise);
                }
            })
        );
        log(`New page opened, trying to obtain it.`);

        const newPagePromise = getNewPageWhenLoaded();
        const newPage = await newPagePromise;
        log(`New page obtained!`);

        // Fetch all content of page.
        await newPage.waitForSelector('body');
        const element = await newPage.evaluate(() => {
            return document.querySelector('body').innerText;
        });
        log(`Page content fetched.`);
        if ($DEBUG) {
            const file = `${Date.now()}-full.png`;
            log(`[DEBUG] writing type 'full' screenshot to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
            await newPage.screenshot({ path: find(`${$PATH.debug}/${uuid}/${file}`) });
        }

        // Populate all data fields.
        const raw = element.replace(/[\r\n]+/gm, '').match(/Labor Information:Wages.*Labor Information:Unemployment Payments/g)?.[0];
        if (!raw) {
            log('[ERROR] Bad data response from website. No data found.');

            // Close new page.
            log(`Finished processing data for ID ${id}, closing new page.`)
            await newPage.close();

            // Go back.
            log(`Going back to main page.`);
            await page.click('div:last-child table:last-child tr:first-child td:last-child input');
            await page.waitForNetworkIdle();

            return;
        }
        const tables = raw.split('Labor Information:Wages').filter(e => e);
        log(`Data processing... removing redundant information.`);

        // Populate sets.
        for (const table of tables) {
            const res = {
                MemberID: data.MemberID,
                SSN: data.SSN,
                FirstName: data.FirstName,
                LastName: data.LastName,
                DOB: data.DOB,
                "EmployerName": table.match(/(?<=Name:\t).*(?=Address)/g)?.[0] ?? '',
                "EmployerAddress": table.match(/(?<=Address:\t).*(?=Current)/g)?.[0] ?? '',
                IncomeData: [{
                    Lag: table.match(/(?<=Lag:\t)(.*?)(?=\tWage:)/g)?.[0] ?? '',
                    "LagWage": parseFloat(table.match(/(?<=Lag:\t)(.*?)(?=\tQtr. Base Weeks)/g)?.[0].split('\t').pop()) ?? '',
                    "LagQtrBaseWeeks": parseFloat(table.match(/(\d{1,}\.\d{1,})(?=Qtr\. 4:)/g)?.[0]) ?? '',

                    Q4: table.match(/(?<=Qtr. 4:\t)(.*?)(?=\tWage:)/g)?.[0] ?? '',
                    "Q4Wage": parseFloat(table.match(/(?<=Qtr. 4:\t)(.*?)(?=\tQtr. Base Weeks)/g)?.[0].split('\t').pop()) ?? '',
                    "Q4QtrBaseWeeks": parseFloat(table.match(/(\d{1,}\.\d{1,})(?=Qtr\. 3:)/g)?.[0]) ?? '',
                    "DisabilityWBR": '',
                    "DisabilityPEDate": '',
                    "UnemploymentPaymentsDatePaid": '',
                    "UnemploymentPaymentsWBR": '',
                }]
            }

            log('Appending finalized data to result object');
            result.MemberData.push(res)
        }


        // Take a screenshot of the data.
        if ($DEBUG) {
            const file = `${Date.now()}-data.json`;
            log(`[DEBUG] writing type 'data' data to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
            writeFileSync(find(`${$PATH.debug}/${uuid}/${file}`), JSON.stringify(result, null, 4));
        }

        // Close new page.
        log(`Finished processing data for ID ${id}, closing new page.`)
        await newPage.close();

        // Go back.
        log(`Going back to main page.`);
        await page.click('div:last-child table:last-child tr:first-child td:last-child input');
        await page.waitForNetworkIdle();
    }

    /**
     * Post-processing logic as well as file cleanup.
     * 
     * @param {string} file The file name for post-processing purposes.
     * @param {object} result The processed data populated with scraped data.
     * @param {number} id An internal ID to control first and last loop occurences.
     * @param {string} uuid The unique ID for the current request.
     * @param {*} result The processed data populated with scraped data.
     */
    async post(file, result, id, uuid) {

        // Check if the original input file still exists so that we know it has not already been processed. If it has, do nothing.
        if ([0, 1, 2, 5].includes(id) && existsSync(find(`${$PATH.incoming}/${file}`))) {
            log(`Data processed and populated, writing to file.`);
            writeFileSync(find(`${$PATH.posted}/${file.split('.').shift()}.json`), JSON.stringify(result, null, 4));

            log(`Sending finalized data to ${$POST.url}.`);
            const response = await get($POST.url, {
                method: 'POST',
                body: JSON.stringify(result),
                headers: { 'Content-Type': 'application/json', ...$POST.headers },
            }).catch(e => e)

            if (response instanceof Error) log(`[ERROR] ${response}\n${response.stack}`);
            else {
                const data = await response.json().catch(e => e);
                if (!data) log(`[ERROR]: No response from ${POST.url}.`);
                else log(`Response received from ${$POST.url}.\n${JSON.stringify(data, null, 4)}`);

                if ($DEBUG) {
                    const file = `${Date.now()}-response.json`;
                    log(`[DEBUG] writing type 'response' data to ${find(`${$PATH.debug}/${uuid}/${file}`)}.`);
                    writeFileSync(find(`${$PATH.debug}/${uuid}/${file}`), JSON.stringify(data ?? {}, null, 4));
                }
            }

            // Move local file to archive.
            log(`Moving file ${find(`${$PATH.incoming}/${file}`)} to ${find(`${$PATH.processed}/${file}`)}.`);
            if (existsSync(find(`${$PATH.incoming}/${file}`))) renameSync(find(`${$PATH.incoming}/${file}`), find(`${$PATH.processed}/${file}`));
        }
    }
}
