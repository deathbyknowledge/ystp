# YSTP
YSTP (short for Your Super Transfer Program) is a file transfer tool that allows sending a file privately to a party directly without relying on port-forwarding to be set up.

It's quick and easy to use and it all lives on Cloudflare's edge, built with Workers and Durable Objects. No storage anywhere, just a transfer.

It's just an educational project, although it does work ofc! You can read the blog posts [here](https://deathbyknowledge.com/posts/ystp-pt1/).

<img width="1312" alt="image" src="https://github.com/user-attachments/assets/f2852631-4ce3-4499-be55-b07916c0a7a1" />

## CLI Client

YSTP includes a command-line client for easy file transfers directly from your terminal.

### Installation

The CLI client is included in this repository. Make sure you have Node.js installed, then navigate to the project directory.

### Usage

#### Send a file
```bash
node cli/ystp.js send <file> [--host hostname] [--port port]
```

#### Receive a file
```bash
node cli/ystp.js receive <code> [--output filename] [--host hostname] [--port port]
```

### Examples

**Send a file:**
```bash
node cli/ystp.js send myfile.txt
# Output: Your shareable code: apple-banana-cherry-date-elderberry
```

**Send to a custom server:**
```bash
node cli/ystp.js send document.pdf --host example.com --port 3000
```

**Receive a file:**
```bash
node cli/ystp.js receive apple-banana-cherry-date-elderberry
```

**Receive with custom filename:**
```bash
node cli/ystp.js receive apple-banana-cherry-date-elderberry --output downloaded.txt
```

### Options

- `--host <host>` - Server hostname (default: localhost)
- `--port <port>` - Server port (default: 8787)
- `-o, --output <file>` - Output filename for receive (default: use sender's filename)

### Features

- **Real-time progress** - See transfer progress with file size and percentage
- **Chunked transfers** - Uses 64KB chunks for efficient memory usage
- **Error handling** - Proper connection and file error management
- **Shareable codes** - Easy-to-remember codes for file sharing
- **Cross-platform** - Works on Windows, macOS, and Linux
