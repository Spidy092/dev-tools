# 🛡️ PHP Protector

**PHP Protector** is a high-performance, developer-friendly tool designed to obfuscate entire PHP projects while perfectly preserving your original directory architecture. It offers two powerful modes: a high-speed **CLI** for local development and a modern **Web Interface** for quick drag-and-drop processing.

---

## ✨ Key Features

*   **Recursion-First**: Automatically traverses all subdirectories and processes files at any depth.
*   **Structure Preservation**: Your output project folder or ZIP will look exactly like your source, including all non-PHP assets (CSS, JS, Images, etc.).
*   **Dual Mode Architecture**:
    *   **CLI**: Best for local workflows and high-speed processing.
    *   **Web**: Modern, dark-themed UI for processed-in-memory folder uploads & downloads.
*   **Safe-by-Design**: Your original source code is **NEVER** modified. All processing is done on copies or in memory.
*   **Performance Optimized**: Uses memory streams and optimized ZIP archiving to handle large project folders (up to 200MB+ in web mode).

---

## 🚀 Installation & Setup

1.  **Prerequisites**: Ensure you have [Node.js](https://nodejs.org/) (v14+) installed.
2.  **Clone/Download**: Extract the project into your local machine.
3.  **Install Dependencies**:
    ```bash
    npm install
    ```

For a full runtime and troubleshooting guide, see [OPERATIONS.md](OPERATIONS.md).

---

## 🖥️ Usage Modes

### 1. Web Mode (Browser)
Perfect for a visual experience. The web interface handles entire folder structures via drag-and-drop.
1.  **Start the server**:
    ```bash
    npm start
    ```
2.  **Open in Browser**: Navigate to `http://localhost:3000`.
3.  **Action**: Drag your PHP project folder into the dropzone. It will upload, obfuscate, and provide a `protected.zip` for download.

### 2. CLI Mode (Terminal)
Fast and reliable for local processing.
```bash
# Basic Usage: Creates 'myfolder_protected' next to your folder
npm run cli -- ./path/to/myfolder

# Create a final ZIP of the protected project
npm run cli -- ./path/to/myfolder --zip

# Specify a custom output location
npm run cli -- ./path/to/myfolder --output ./custom_path
```

---

## 🛠️ How It Works

1.  **Scanning**: The tool recursively identifies every file within the input directory.
2.  **Filtering**:
    *   **`.php` files**: Strips the opening PHP tag, applies `base64` encoding, and wraps the payload in a secure `eval(base64_decode(...))` container preceded by a PHP escape sequence for compatibility with mixed HTML/PHP files.
    *   **Other files**: CSS, JavaScript, Images, and HTML assets are copied exactly as-is to ensure the logical integrity of your project.
3.  **Mirroring**: Recreates every subdirectory found in the source at the destination path.
4.  **Finalization**: Generates a clean, protected version of your project ready for deployment.

---

## ⚠️ Important Note
This tool is intended for basic obfuscation and structure protection. It does not provide cryptographic security but prevents simple code reading and theft. Always maintain backups of your original source code.

---
*Created with ❤️ for PHP Developers.*
