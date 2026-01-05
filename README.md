# TRA - WhatsApp Server

TRA is a WhatsApp-based server built with [Baileys](https://github.com/WhiskeySockets/Baileys) and [Hono](https://hono.dev/), allowing users to register and execute commands via WhatsApp text messages or a Web Dashboard.

## Features

- **WhatsApp Integration**: Connects using Baileys. Handles sessions and QR codes seamlessly.
- **Command Management**:
    - **Register commands**: Define commands with specific arguments (required, optional, default values).
    - **Execute commands**: Trigger external Webhooks (POST requests) with parsed arguments.
    - **Manage via WhatsApp**: Use `/command register` directly in chat.
    - **Manage via Dashboard**: Use the web interface to add/edit/delete commands.
- **Web Dashboard**:
    - Secure login via `TRA_API_KEY`.
    - View all registered commands.
    - Interactive form to register new commands.
    - Visual QR Code display for easy connection.
- **API**:
    - `POST /api/send-message`: Send WhatsApp messages programmatically.

## Setup & Run

### Prerequisites
- Node.js (v20+)
- NPM

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure Environment Variables:
   Create a `.env` file (see `.env.example` or use defaults):
   ```env
   TRA_API_KEY=tra_secret_key_123
   PORT=3000
   DATABASE_URL=tra.db
   ```

### Running the Server

Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## Usage

### 1. Connection
- Open `http://localhost:3000` in your browser.
- Login with your `TRA_API_KEY`.
- Scan the QR Code displayed on the dashboard using WhatsApp (Linked Devices).

### 2. Dashboard
- **Add Command**: Click "+ Add Command" to open the registration form.
- **Edit Command**: Click the pencil icon on a command card.
- **Delete Command**: Click the trash icon.

### 3. WhatsApp Commands

You can interact with the bot directly in WhatsApp:

**List Commands:**
```text
/command list
```

**Register Command (Syntax):**
```text
/command register <key> --description <desc> --urlCall <url> [--argKey: <key> ...]
```
Example:
```text
/command register trigger deployment --description Trigger deploy --urlCall https://api.example.com/deploy [--argKey: id --required: true]
```

**Execute Command:**
```text
/trigger deployment --id 123
```

**System Commands:**
- `/help`: Show usage help.
- `/qr`: Check connection status (or get QR if disconnected).

### 4. API Reference

#### Send Message
Send a WhatsApp message programmatically.

- **URL**: `/api/send-message`
- **Method**: `POST`
- **Headers**: 
    - `Content-Type: application/json`
    - `x-api-key: <TRA_API_KEY>`
- **Body**:
  ```json
  {
    "jid": "1234567890@s.whatsapp.net",
    "text": "Hello from TRA!"
  }
  ```

#### Command Webhooks
When a command is executed, TRA sends a `POST` request to the registered `urlCall` with the parsed arguments as the JSON body.

## Architecture

- **Runtime**: Node.js
- **Framework**: Hono (Server), Alpine.js + HTMX (Frontend)
- **WhatsApp Library**: @whiskeysockets/baileys
- **Database**: Better-SQLite3
- **Validation**: Zod
