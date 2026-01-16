# Zypherous Next-Gen Dashboard

Zypherous Next-Gen is a user-friendly dashboard for managing Pterodactyl-powered servers. It focuses on fast server workflows, clear admin controls, and an integrated economy system.

## Extended Features

- Server lifecycle: create, start, stop, reinstall, and monitor resources.
- Server tools: live console, file manager, schedules, allocations, subdomains, and plugin browsing.
- Economy system: balances, transfers, AFK rewards, task-based earning, Linkvertise support, and a store.
- Admin suite: users, nodes, eggs, plans, coins, logs, maintenance, and system settings.
- Authentication: OAuth2 (Discord/Google) and session management.
- UI/UX: responsive layouts, notifications, skeleton loaders, and a clean dashboard flow.
- Extensibility: modular handlers and page routing for custom features.

Note: This dashboard is still in development and may not work as expected.

# Install Guide

## 1. Configuring Zypherous

### Pterodactyl method (easiest)

Warning: You need Pterodactyl already set up on a domain for this method to work.

1. Upload the files to a Pterodactyl NodeJS server. Download the egg from Parkervcp's repository:
   https://github.com/parkervcp/eggs/blob/master/generic/nodejs/egg-node-js-generic.json
2. Unarchive the files and set the server to use NodeJS 16.

### Direct method

1. Install Node.js 16 or newer. It is recommended to install it with nvm:

- `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash`
- reopen a new ssh session (e.g., restart putty)
- `nvm install 16`
- check the node version with `node -v` and switch between versions with `nvm use <version>`

2. Download Zypherous Next-Gen files in `/var/www/Zypherous-next-gen`:

- `git clone https://github.com/urixen-org/Zypherous-next-gen.git /var/www/Zypherous-next-gen`

3. Install required node modules (and build dependencies to avoid errors):

- `apt-get update && apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev build-essential`
- `cd /var/www/Zypherous-next-gen && npm i`

After configuring `config.yaml`, to start the server, use `node app.js`.
To run in the background, use PM2 (see PM2 section).

## 2. Setting up webserver

1. Copy `config-example.yaml` to `config.yaml` and configure it (specify panel domain/apikey and discord auth settings for it to work).
2. Start the server (ignore the 2 strange errors that might come up).
3. Login to your DNS manager, point the domain you want your dashboard to be hosted on to your VPS IP address (example: dashboard.domain.com 192.168.0.1).
4. Run `apt install nginx && apt install certbot` on the VPS.
5. Run `ufw allow 80` and `ufw allow 443` on the VPS.
6. Run `certbot certonly -d <Your Zypherous Domain>` then do 1 and put your email.
7. Run `nano /etc/nginx/sites-enabled/Zypherous.conf`.
8. Paste the configuration at the bottom of this and replace with the IP of the Pterodactyl server including the port and with the domain you want your dashboard to be hosted on.
9. Run `systemctl restart nginx` and try opening your domain.

# Running in background and on startup

Installing pm2:
- Run `npm install pm2 -g` on the VPS.

Starting the Dashboard in Background:
- Change directory to your Zypherous folder using `cd`, example: `cd /var/www/Zypherous-next-gen`.
- To run Zypherous, use `pm2 start app.js --name "Zypherous"`.
- To view logs, run `pm2 logs Zypherous`.

Making the dashboard run on startup:
- Make sure your dashboard is running in the background with pm2.
- You can check if Zypherous is running in background with `pm2 list`.
- Once you confirm Zypherous is running in background, create a startup script by running `pm2 startup` and `pm2 save`.
- Note: Supported init systems are `systemd`, `upstart`, `launchd`, `rc.d`.
- To stop Zypherous from running in the background, use `pm2 unstartup`.

To stop a currently running Zypherous instance, use `pm2 stop Zypherous`.

# Credits

Made by Vspcoderz: https://github.com/urixen-org

# Nginx Proxy Config

```Nginx
server {
    listen 80;
    server_name <domain>;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <domain>;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers  HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location /afk/ws {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://localhost:<port>/afk/ws;
    }
    location / {
        proxy_pass http://localhost:<port>/;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
