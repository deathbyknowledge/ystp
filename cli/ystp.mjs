#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8787;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function getProgressBar(current, total) {
  const width = 40;
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const percent = Math.round((current / total) * 100);
  return `[${bar}] ${percent}% (${formatBytes(current)}/${formatBytes(total)})`;
}

// Send command
async function sendFile(filePath, options) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const protocol = options.protocol || 'ws';

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const fileStats = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const fileSize = fileStats.size;

  const url = `${protocol}://${host}:${port}/send`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let sessionCode = null;
    let bytesSent = 0;

    ws.on('open', () => {
      console.log('✓ Connected to server');
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.code && !sessionCode) {
          sessionCode = data.code;
          console.log(`✓ Session created with code: ${sessionCode}`);
          console.log(`\nShare this code with the receiver:`);
          console.log(`  ${sessionCode}\n`);

          // Send file metadata
          const metadata = { name: fileName, size: fileSize };
          ws.send(JSON.stringify(metadata));
          console.log(`Sending file: ${fileName} (${formatBytes(fileSize)})`);
          console.log('Waiting for receiver approval...\n');
        } else if (data === 'LET_IT_RIP') {
          // Receiver approved, start sending file
          console.log('✓ Receiver approved! Starting transfer...\n');
          sendFileChunks(ws);
        }
      } catch (err) {
        console.error('Error parsing message:', err.message);
      }
    });

    ws.on('close', () => {
      if (bytesSent === fileSize) {
        console.log('\n✓ Transfer completed successfully!');
        resolve();
      } else {
        console.error('\n✗ Connection closed unexpectedly');
        reject(new Error('Connection closed'));
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      reject(error);
    });

    function sendFileChunks(ws) {
      const fileStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      let lastUpdate = Date.now();

      fileStream.on('data', (chunk) => {
        ws.send(chunk);
        bytesSent += chunk.length;

        // Update progress bar every 100ms
        const now = Date.now();
        if (now - lastUpdate > 100) {
          process.stdout.write(`\r${getProgressBar(bytesSent, fileSize)}`);
          lastUpdate = now;
        }
      });

      fileStream.on('end', () => {
        process.stdout.write(`\r${getProgressBar(fileSize, fileSize)}\n`);
        ws.send('EOF');
      });

      fileStream.on('error', (error) => {
        console.error('\nFile read error:', error.message);
        ws.close();
        reject(error);
      });
    }
  });
}

// Receive command
async function receiveFile(code, options) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const protocol = options.protocol || 'ws';
  const outputDir = options.output || '.';

  const url = `${protocol}://${host}:${port}/receive/${code}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let fileMetadata = null;
    let bytesReceived = 0;
    let fileHandle = null;

    ws.on('open', () => {
      console.log('✓ Connected to server');
      console.log('Waiting for file metadata...\n');
    });

    ws.on('message', async (message) => {
      try {
        // First message is metadata
        if (!fileMetadata) {
          fileMetadata = JSON.parse(message);
          const filePath = path.join(outputDir, fileMetadata.name);

          // Check if file already exists
          if (fs.existsSync(filePath)) {
            console.error(`Error: File already exists: ${filePath}`);
            ws.close();
            reject(new Error('File exists'));
            return;
          }

          console.log(`Receiving file: ${fileMetadata.name} (${formatBytes(fileMetadata.size)})`);
          console.log('');

          fileHandle = fs.createWriteStream(filePath);
          fileHandle.on('error', (err) => {
            console.error('File write error:', err.message);
            ws.close();
            reject(err);
          });

          // Approve transfer
          ws.send('LET_IT_RIP');
        } else {
          // Receiving file chunks
          if (typeof message === 'string' && message === 'EOF') {
            process.stdout.write(`\r${getProgressBar(bytesReceived, fileMetadata.size)}\n`);
            fileHandle.end();
            console.log('\n✓ File received successfully!');
            console.log(`Saved to: ${path.join(outputDir, fileMetadata.name)}`);
            resolve();
          } else {
            // Binary chunk
            fileHandle.write(message);
            bytesReceived += message.length;

            process.stdout.write(`\r${getProgressBar(bytesReceived, fileMetadata.size)}`);
          }
        }
      } catch (err) {
        console.error('Error processing message:', err.message);
        ws.close();
        reject(err);
      }
    });

    ws.on('close', () => {
      if (fileHandle) {
        fileHandle.destroy();
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      if (fileHandle) {
        fileHandle.destroy();
      }
      reject(error);
    });
  });
}

// Parse CLI arguments
function parseArgs(args) {
  const command = args[0];
  const target = args[1];
  const options = {};

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
      options.host = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (args[i] === '--protocol' && args[i + 1]) {
      options.protocol = args[i + 1];
      i++;
    }
  }

  return { command, target, options };
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
YSTP - Your Super Transfer Program CLI Client

Usage:
  ystp send <file> [options]        Send a file
  ystp receive <code> [options]     Receive a file

Options:
  --host <hostname>      Server host (default: ${DEFAULT_HOST})
  --port <port>          Server port (default: ${DEFAULT_PORT})
  --output <path>        Output directory for received files (default: current directory)
  --protocol <protocol>  WebSocket protocol: ws or wss (default: ws)

Examples:
  ystp send document.pdf
  ystp receive apple-banana-cherry-date --output ~/downloads
  ystp send file.zip --host example.com --port 443 --protocol wss
`);
    process.exit(0);
  }

  const { command, target, options } = parseArgs(args);

  try {
    if (command === 'send') {
      if (!target) {
        console.error('Error: File path required for send command');
        process.exit(1);
      }
      await sendFile(target, options);
    } else if (command === 'receive') {
      if (!target) {
        console.error('Error: Session code required for receive command');
        process.exit(1);
      }
      await receiveFile(target, options);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error('Use "ystp" with no arguments to see help');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

main();
