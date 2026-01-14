#!/usr/bin/env node

/**
 * YSTP CLI Client
 * 
 * A WebSocket-based file transfer client for YSTP (Your Simple Transfer Protocol).
 * 
 * Usage:
 *   ystp send <file> [--host hostname] [--port port]
 *   ystp receive <code> [--output filename] [--host hostname] [--port port]
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { createInterface } = require('readline');
const { parseArgs } = require('util');

// Configuration
const CHUNK_SIZE = 64 * 1024; // 64KB chunks as per protocol
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8787;

// Progress tracking
let totalBytes = 0;
let transferredBytes = 0;
let lastProgressUpdate = 0;

/**
 * Parse command line arguments
 */
function parseCommandLine() {
  const args = process.argv.slice(2);
  const positionals = [];
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    output: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
      options.host = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      options.port = parseInt(args[++i], 10);
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i] === '-o' && args[i + 1]) {
      options.output = args[++i];
    } else if (args[i].startsWith('--')) {
      console.error(`Unknown option: ${args[i]}`);
      printUsage();
      process.exit(1);
    } else {
      positionals.push(args[i]);
    }
  }

  return { positionals, options };
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
YSTP CLI - File Transfer Client

Usage:
  node cli/ystp.js send <file> [--host hostname] [--port port]
  node cli/ystp.js receive <code> [--output filename] [--host hostname] [--port port]

Commands:
  send <file>       Send a file and get a shareable code
  receive <code>    Receive a file using a shareable code

Options:
  --host <host>     Server hostname (default: localhost)
  --port <port>     Server port (default: 8787)
  -o, --output <file>  Output filename for receive (default: use sender's filename)

Examples:
  Send a file:
    node cli/ystp.js send myfile.txt
    node cli/ystp.js send myfile.txt --host example.com --port 3000

  Receive a file:
    node cli/ystp.js receive apple-banana-cherry-date-elderberry
    node cli/ystp.js receive apple-banana-cherry-date-elderberry --output downloaded.txt
`);
}

/**
 * Get the WebSocket URL for the given host and port
 */
function getWebSocketUrl(host, port, path) {
  const protocol = port === 443 ? 'wss' : 'ws';
  return `${protocol}://${host}:${port}${path}`;
}

/**
 * Update and display progress
 */
function updateProgress(bytes) {
  transferredBytes += bytes;
  const now = Date.now();
  
  // Update progress at most 10 times per second
  if (now - lastProgressUpdate > 100) {
    const percent = totalBytes > 0 ? Math.round((transferredBytes / totalBytes) * 100) : 0;
    const mb = (transferredBytes / (1024 * 1024)).toFixed(2);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
    
    process.stdout.write(`\rProgress: ${percent}% (${mb}/${totalMb} MB)`);
    lastProgressUpdate = now;
  }
}

/**
 * Clear progress line
 */
function clearProgress() {
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Send a file
 */
async function sendFile(filePath, options) {
  const fullPath = path.resolve(filePath);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Get file stats
  const stats = fs.statSync(fullPath);
  const fileName = path.basename(fullPath);
  const fileSize = stats.size;

  console.log(`Sending file: ${fileName}`);
  console.log(`Size: ${formatFileSize(fileSize)}`);
  console.log(`Connecting to: ${options.host}:${options.port}...\n`);

  return new Promise((resolve, reject) => {
    const wsUrl = getWebSocketUrl(options.host, options.port, '/send');
    const ws = new WebSocket(wsUrl);

    let fileHandle = null;

    ws.on('open', async () => {
      console.log('Connected! Waiting for code...');
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // First message contains the shareable code
        if (message.code) {
          console.log(`Your shareable code: ${message.code}`);
          console.log('Waiting for receiver to connect...\n');

          // Send file metadata
          const metadata = JSON.stringify({ name: fileName, size: fileSize });
          ws.send(metadata);
          console.log('Waiting for receiver approval...');
        } else if (message.name && message.size) {
          // Receiver connected with metadata echo
          console.log(`Receiver connected! Ready to transfer "${message.name}"\n`);
        } else if (message === 'LET_IT_RIP') {
          // Receiver approved transfer, start sending chunks
          console.log('Transfer started!\n');
          totalBytes = fileSize;
          transferredBytes = 0;
          
          try {
            fileHandle = await fs.promises.open(fullPath, 'r');
            let offset = 0;

            while (offset < fileSize) {
              const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize - offset));
              const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, offset);
              
              if (bytesRead === 0) break;
              
              ws.send(buffer);
              updateProgress(bytesRead);
              offset += bytesRead;
            }

            // Send EOF marker
            ws.send('EOF');
            clearProgress();
            console.log(`\n✓ File sent successfully!`);
            ws.close();
          } catch (err) {
            ws.close();
            if (fileHandle) await fileHandle.close();
            reject(err);
          }
        }
      } catch (err) {
        // Non-JSON message (shouldn't happen in this protocol)
        console.error('Error parsing message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('\nConnection error:', err.message);
      if (fileHandle) fileHandle.close();
      reject(err);
    });

    ws.on('close', async () => {
      if (fileHandle) await fileHandle.close();
      resolve();
    });
  });
}

/**
 * Receive a file
 */
async function receiveFile(code, options) {
  console.log(`Receiving file with code: ${code}`);
  console.log(`Connecting to: ${options.host}:${options.port}...\n`);

  return new Promise((resolve, reject) => {
    const wsUrl = getWebSocketUrl(options.host, options.port, `/receive/${code}`);
    const ws = new WebSocket(wsUrl);

    let fileName = null;
    let fileSize = 0;
    let fileHandle = null;
    let receivedBytes = 0;

    ws.on('open', () => {
      console.log('Connected! Waiting for metadata...');
    });

    ws.on('message', async (data) => {
      try {
        // Check if this is JSON (metadata) or binary data
        const str = data.toString();
        
        if (str.startsWith('{')) {
          // Metadata
          const metadata = JSON.parse(str);
          fileName = options.output || metadata.name;
          fileSize = metadata.size;
          totalBytes = fileSize;
          transferredBytes = 0;
          receivedBytes = 0;

          console.log(`File: ${fileName}`);
          console.log(`Size: ${formatFileSize(fileSize)}`);
          console.log(`\nWaiting for sender to start...`);

          // Send approval to start transfer
          ws.send('LET_IT_RIP');
        } else if (str === 'EOF') {
          // End of file
          clearProgress();
          console.log(`\n✓ File received successfully as "${fileName}"`);
          if (fileHandle) await fileHandle.close();
          ws.close();
          resolve();
        } else {
          // Binary chunk
          if (!fileHandle) {
            // Open file for writing
            try {
              fileHandle = await fs.promises.open(fileName, 'w');
              console.log('\nReceiving data...\n');
            } catch (err) {
              console.error(`\nError creating file "${fileName}":`, err.message);
              ws.close();
              reject(err);
              return;
            }
          }

          // Write chunk to file
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          await fileHandle.write(buffer);
          receivedBytes += buffer.length;
          updateProgress(buffer.length);
        }
      } catch (err) {
        console.error('Error processing message:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('\nConnection error:', err.message);
      if (fileHandle) fileHandle.close();
      reject(err);
    });

    ws.on('close', async () => {
      if (fileHandle) await fileHandle.close();
      resolve();
    });
  });
}

/**
 * Main entry point
 */
async function main() {
  const { positionals, options } = parseCommandLine();

  if (positionals.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = positionals[0];

  switch (command) {
    case 'send': {
      if (positionals.length < 2) {
        console.error('Error: send command requires a file path');
        printUsage();
        process.exit(1);
      }
      await sendFile(positionals[1], options);
      break;
    }

    case 'receive': {
      if (positionals.length < 2) {
        console.error('Error: receive command requires a code');
        printUsage();
        process.exit(1);
      }
      await receiveFile(positionals[1], options);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// Run the CLI
main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
