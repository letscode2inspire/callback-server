const express = require('express');
const bodyParser = require('body-parser');
const xml2js = require('xml2js');
const chalk = require('chalk');

const app = express();
const PORT = Number(process.env.PORT || process.env.RAILWAY_PORT || 3000);

// Middleware to parse XML
app.use(bodyParser.text({ type: 'text/xml' }));
app.use(bodyParser.text({ type: 'application/soap+xml' }));

// Parse XML helper
const parseXML = async (xmlString) => {
  try {
    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [xml2js.processors.stripPrefix]
    });
    return await parser.parseStringPromise(xmlString);
  } catch (error) {
    console.error('XML Parse Error:', error);
    return null;
  }
};

// Extract firmware status from accessPoint
const extractFirmwareStatus = (accessPoint) => {
  if (!accessPoint) return null;
  
  const status = {
    accessPointId: accessPoint.id || 'N/A',
    serialNumber: accessPoint.serialNumber || 'N/A',
    online: accessPoint.online || 'N/A',
    syncStatus: accessPoint.syncStatus || 'N/A',
    firmwareUpgradeStatus: accessPoint.firmwareUpgradeStatus || 'N/A',
    timeOfLastFirmwareUpgrade: accessPoint.timeOfLastFirmwareUpgrade || 'N/A',
    attributes: {}
  };

  // Extract attributes
  if (accessPoint.accessPointAttributes && accessPoint.accessPointAttributes.attributes) {
    let attrs = accessPoint.accessPointAttributes.attributes;
    
    // Handle both single attribute and array
    if (!Array.isArray(attrs)) {
      attrs = [attrs];
    }

    attrs.forEach(attr => {
      const name = attr.name || attr.Name || attr.NAME;
      const value = attr.value || attr.Value || attr.VALUE;
      if (name) {
        status.attributes[name] = value;
      }
    });
  }

  return status;
};

// Log formatter
const logCallback = (type, data) => {
  const timestamp = new Date().toISOString();
  console.log('\n' + chalk.cyan('='.repeat(80)));
  console.log(chalk.yellow(`[${timestamp}] ${type} Callback Received`));
  console.log(chalk.cyan('='.repeat(80)));
  
  if (type === 'notifyUpdated') {
    const status = extractFirmwareStatus(data);
    
    console.log(chalk.green('📱 Access Point Information:'));
    console.log(`   ID: ${chalk.white(status.accessPointId)}`);
    console.log(`   Serial: ${chalk.white(status.serialNumber)}`);
    console.log(`   Online: ${chalk.white(status.online)}`);
    console.log(`   Sync Status: ${chalk.white(status.syncStatus)}`);
    
    console.log(chalk.green('\n🔧 Firmware Status:'));
    console.log(`   Upgrade Status: ${chalk.yellow.bold(status.firmwareUpgradeStatus)}`);
    console.log(`   Last Update: ${chalk.white(status.timeOfLastFirmwareUpgrade)}`);
    
    if (Object.keys(status.attributes).length > 0) {
      console.log(chalk.green('\n📊 Attributes:'));
      
      // Highlight firmware-related attributes
      const firmwareAttrs = [
        'FIRMWARE_VERSION',
        'FIRMWARE_VERSION_INPROGRESS',
        'FIRMWARE_UPLOAD_PERCENTAGE',
        'CC_FIRMWARE_VERSION',
        'CC_FIRMWARE_VERSION_INPROGRESS',
        'CC_FIRMWARE_UPLOAD_PERCENTAGE'
      ];
      
      firmwareAttrs.forEach(key => {
        if (status.attributes[key]) {
          console.log(`   ${chalk.cyan(key)}: ${chalk.yellow.bold(status.attributes[key])}`);
        }
      });
      
      // Show other attributes
      Object.keys(status.attributes).forEach(key => {
        if (!firmwareAttrs.includes(key)) {
          console.log(`   ${chalk.gray(key)}: ${status.attributes[key]}`);
        }
      });
    }
  } else if (type === 'newEvent') {
    console.log(chalk.green('📋 Event Information:'));
    console.log(`   Origin: ${chalk.white(data.origin?.logOriginType || 'N/A')}`);
    console.log(`   Family: ${chalk.white(data.family || 'N/A')}`);
    console.log(`   Code: ${chalk.yellow.bold(data.code || 'N/A')}`);
    console.log(`   Timestamp: ${chalk.white(data.timeStamp || 'N/A')}`);
    
    if (data.logData) {
      console.log(chalk.green('\n📋 Log Data:'));
      let logData = data.logData;
      if (!Array.isArray(logData)) {
        logData = [logData];
      }
      logData.forEach(item => {
        console.log(`   ${chalk.cyan(item.key || 'N/A')}: ${item.value || 'N/A'}`);
      });
    }
  }
  
  console.log(chalk.cyan('='.repeat(80)) + '\n');
};

// Main callback endpoint
app.post('*', async (req, res) => {
  try {
    const soapAction = req.headers['action'] || 
                       req.headers['soapaction'] || 
                       'unknown';
    
    console.log(chalk.gray(`\nReceived request to: ${req.path}`));
    console.log(chalk.gray(`SOAPAction: ${soapAction}`));
    
    // Parse the SOAP envelope
    const parsed = await parseXML(req.body);
    
    if (!parsed) {
      console.log(chalk.red('❌ Failed to parse SOAP envelope'));
      return res.status(400).send('Invalid SOAP');
    }

    // Extract the body
    const envelope = parsed.Envelope;
    const body = envelope?.Body;
    
    let responseEnvelope;
    
    // Handle notifyUpdated (AccessPoint status changes - FIRMWARE UPGRADES)
    if (body?.notifyUpdated) {
      const accessPoint = body.notifyUpdated.accessPoint;
      logCallback('notifyUpdated', accessPoint);
      
      responseEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <ns:notifyUpdatedResponse xmlns:ns="http://xml.assaabloy.com/dsr/2.0"/>
  </soap:Body>
</soap:Envelope>`;
    }
    // Handle newEvent (Log entries, events, alarms)
    else if (body?.newEvent) {
      const logEntry = body.newEvent.logEntry;
      logCallback('newEvent', logEntry);
      
      responseEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <ns:newEventResponse xmlns:ns="http://xml.assaabloy.com/dsr/2.0"/>
  </soap:Body>
</soap:Envelope>`;
    }
    // Unknown callback type
    else {
      console.log(chalk.yellow('⚠️  Unknown callback type'));
      console.log(chalk.gray('Body:'), JSON.stringify(body, null, 2));
      
      responseEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body/>
</soap:Envelope>`;
    }

    // Send proper SOAP response
    res.set('Content-Type', 'application/soap+xml; charset=utf-8');
    res.status(200).send(responseEnvelope);
    
  } catch (error) {
    console.error(chalk.red('❌ Error processing callback:'), error);
    res.status(500).send('Internal Server Error');
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DSR Callback Server is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'DSR Callback Server is running'
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('\n🚀 Callback Testing Server Started');
  console.log(`\nListening on port ${PORT}`);
  console.log(`PORT env: ${process.env.PORT || 'unset'}`);
  console.log(`RAILWAY_PORT env: ${process.env.RAILWAY_PORT || 'unset'}`);
  console.log('\nWaiting for callbacks...\n');
});

server.on('error', (error) => {
  console.error('Server listen error:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Shutting down DSR Callback Server...'));
  process.exit(0);
});
