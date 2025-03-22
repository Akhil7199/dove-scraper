### Project Title: DOVE Scraper

#### Overview

The **DOVE Scraper** is a background service application designed to automate the process of web scraping specific data from a designated website. This application operates without a graphical user interface (GUI) and is intended for Windows systems. It utilizes various libraries such as Electron, Puppeteer, and Express to manage tasks, perform web scraping, and handle incoming data requests.

#### Purpose

This project was developed as a volunteer initiative to streamline data collection processes for specific user information. By automating the scraping of data, the application reduces manual effort and increases efficiency in data handling. The DOVE Scraper is particularly useful for organizations that require regular updates on user data without the need for constant human intervention.

#### Features

- **Background Service**: Runs as a background application without a GUI, minimizing resource usage.
- **Web Scraping**: Utilizes Puppeteer to navigate and extract data from web pages.
- **REST API**: Implements an Express server to handle incoming data requests and provide status updates.
- **File Management**: Monitors directories for new files to process and organizes output data.
- **Scheduled Tasks**: Uses cron jobs to control when scraping occurs, ensuring it only runs during specified hours.
- **Logging**: Maintains detailed logs of operations for debugging and monitoring purposes.

#### Components

1. **DOVE Scraper**:

   - This is the core component responsible for the web scraping logic. It handles the interaction with the target website, including logging in, filling out forms, and retrieving data. The Scraper processes incoming data files and manages the scraping workflow.

2. **Manager**:

   - The Manager class oversees the scheduling of scraping tasks. It uses cron jobs to activate and deactivate the scraping process based on specified hours (0700-1900 EST). The Manager also checks the current time to determine if the scraper should be active and manages the logging of operations.

3. **Monitor**:
   - The Monitor component is responsible for watching the incoming directory for new files. It triggers the scraping process when new files are detected, ensuring that the application processes data in real-time. The Monitor works in conjunction with the Scraper to handle incoming requests efficiently.

#### How It Works

1. **Initialization**:

   - The application starts by loading configuration settings from a JSON file. It sets up necessary directories for incoming, processed, and log files.

   ```javascript
   const cfg = find(void 0, 0); // Load configuration
   ```

2. **Taskbar Integration**:

   - The application creates a system tray icon for easy access to configuration and log files.

   ```javascript
   global.tray = new Tray(resolve(__dirname, "./icon.png"));
   ```

3. **REST API**:

   - The Express server listens for incoming POST requests containing user data. It validates the data and writes it to an incoming directory for processing.

   ```javascript
   express()
     .use(express.json())
     .post($ENDPOINT.service, (req, res) => {
       // Validate and process incoming data
     });
   ```

4. **Web Scraping**:

   - When new files are detected in the incoming directory, the application triggers the scraping process using Puppeteer. It logs into the target website, fills out forms with the provided data, and retrieves the necessary information.

   ```javascript
   const browser = await launch({ headless: $HEADLESS });
   const page = await browser.newPage();
   await page.goto($LOGIN.url);
   ```

5. **Data Processing**:

   - The scraped data is processed and saved in a structured format. The application also handles errors gracefully, moving failed files to a designated directory for review.

   ```javascript
   writeFileSync(find(`${$PATH.incoming}/${id}`), JSON.stringify(req.body));
   ```

6. **Scheduled Operations**:

   - Cron jobs manage the timing of scraping activities, ensuring that they occur only during specified hours (0700-1900 EST).

   ```javascript
   this.open = cron.schedule($CRON.open, () => {
     global.active = true; // Activate scraping
   });
   ```

7. **Output Management**:

   - After processing, the application sends the scraped data to a specified endpoint and archives the original input files.

   ```javascript
   await fetch($POST.url, { method: "POST", body: JSON.stringify(result) });
   ```

#### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/yourusername/dove-scraper.git
   cd dove-scraper
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure the application**:

   - Edit the `_config.json` file to set your specific configurations, such as endpoints and paths.

4. **Run the application**:
   ```bash
   npm start
   ```

#### Usage

- **Sending Data**: To send data to the scraper, make a POST request to the configured endpoint with the required user data. Here’s an example using `curl`:

  ```bash
  curl -X POST http://localhost:YOUR_PORT/your-endpoint \
  -H "Content-Type: application/json" \
  -d '{
      "MemberData": [
          {
              "FirstName": "John",
              "LastName": "Doe",
              "MemberID": "12345",
              "SSN": "123456789",
              "DOB": "01011990"
          }
      ],
      "CaseNumber": "ABC123"
  }'
  ```

- **Monitoring Logs**: Check the logs for any errors or status updates. Logs are stored in the specified log directory.

#### Contribution

This project is open for contributions. If you would like to contribute, please fork the repository and submit a pull request.

#### Related Interests

This project aligns with my interests in automation, data processing, and web technologies. I am passionate about creating efficient solutions that reduce manual workloads and improve data accuracy. This volunteer initiative allowed me to apply my skills in JavaScript and web scraping while contributing to a meaningful cause.

#### License

This project is licensed under the MIT License. See the LICENSE file for more details.

---

Feel free to adjust any sections or add more specific examples based on your implementation. This README aims to provide clarity and ease of understanding for anyone who might use or contribute to your project.
