# KTV Gym Check-in & Admin Tool

A modernized, secure, and self-contained gym check-in system.

## Features

- **Modern ES Modules**: Clean, modular project structure.
- **Tailwind CSS 4.0**: Fast and responsive UI, bundled locally.
- **SQLite Database**: Lightweight and persistent storage.
- **Dockerized**: Built with Chainguard images for maximum security and minimal footprint.
- **Self-Contained**: No external dependencies (fonts, styles, or scripts loaded from CDNs).

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
docker run -p 3000:3000 \
  -e ADMIN_PASSWORD=your_password \
  -e SESSION_SECRET=your_secret \
  -v $(pwd)/data:/app/data \
  gym-checkin
```

### Environment Variables

| Variable         | Description                        | Default         |
| :--------------- | :--------------------------------- | :-------------- |
| `PORT`           | The port to listen on.             | `3000`          |
| `BASE_PATH`      | The base path for the application. | `''`            |
| `DB_PATH`        | Path to the SQLite database.       | `./data/gym.db` |
| `ADMIN_PASSWORD` | Password for the admin dashboard.  | _Required_      |
| `SESSION_SECRET` | Secret for session encryption.     | _Required_      |

## Security

This project uses:

- **Helmet**: Security headers.
- **Morgan**: Request logging.
- **Compression**: Gzip compression for faster delivery.
- **Chainguard Node Image**: Minimal, rootless, and hardened production image.
