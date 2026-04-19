# Gym Check-in & Admin Tool

A modernized, secure, and self-contained gym check-in and administration system designed for clubs and fitness centers.

## Features

- **Check-in System**: Simple, PIN-protected check-in for trainers at specific gym halls.
- **QR Code Integration**: Automatic QR code generation for each hall to facilitate quick access to the check-in page.
- **Reporting (PRAE)**: Automated generation of "Pauschale Reiseaufwandsentschädigung" (PRAE) documents as Excel files using Carbone templates.
- **Trainer Self-Service**: Trainers can export their own monthly reports using their PIN.
- **Admin Dashboard**: Comprehensive management of halls, trainers, and assignments.
- **Modern Tech Stack**:
  - **Express 5.x**: Next-generation web framework for Node.js.
  - **Tailwind CSS 4.0**: Fast, local-first styling with no external CDNs.
  - **SQLite 3**: Robust and lightweight persistent storage.
- **Localization**: Full internationalization support (default: German).
- **Security & Privacy**:
  - **Hardened Docker Image**: Uses Chainguard Node images (minimal, rootless, and secure).
  - **Security Headers**: Powered by Helmet.
  - **No CDNs**: All assets (fonts, styles, scripts) are served locally for privacy and offline capability.
- **Deployment Flexibility**: Support for `BASE_PATH` for hosting behind reverse proxies.

## Local Development

1.  **Install dependencies**:

    ```bash
    npm install
    ```

2.  **Build CSS**:

    ```bash
    npm run build:css
    ```

3.  **Start development server**:
    ```bash
    npm run dev
    ```

## Docker Deployment

Build the image:

```bash
docker build -t gym-checkin .
```

Run the container:

```bash
# Docker
docker run -p 3000:3000 \
  -e ADMIN_PASSWORD=your_password \
  -e SESSION_SECRET=your_secret \
  -v $(pwd)/data:/data \
  gym-checkin

# Podman (handles SELinux and permissions with :Z)
podman run -p 3000:3000 \
  -e ADMIN_PASSWORD=your_password \
  -e SESSION_SECRET=your_secret \
  -v ./data:/data:Z \
  gym-checkin
```

### Environment Variables

| Variable         | Description                                       | Default         |
| :--------------- | :------------------------------------------------ | :-------------- |
| `PORT`           | The port to listen on.                            | `3000`          |
| `BASE_PATH`      | The base path for the application (e.g., `/gym`). | `''`            |
| `DB_PATH`        | Directory for SQLite databases.                    | `./data`         |
| `ADMIN_PASSWORD` | Password for the admin dashboard.                 | _Required_      |
| `SESSION_SECRET` | Secret for session encryption.                    | _Required_      |


## Technical Details

### PRAE Reporting
The system uses `carbone` to render Excel templates located in `resources/`. The data is aggregated per trainer and month, calculating reimbursements based on the configured hourly wage.

### Security
The production Docker image is based on `cgr.dev/chainguard/node`, providing a minimal attack surface. The application runs as a non-root user.
