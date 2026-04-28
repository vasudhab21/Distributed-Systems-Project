# Presentation Day Runbook

Use this checklist on the day of the demo.

## What To Keep Ready

- AWS Learner Lab account
- EC2 key file on your laptop
- Project folder on your laptop
- One browser tab for the game
- One browser tab for the admin panel
- One terminal window connected to the EC2 server

## AWS Launch Checklist

Launch an EC2 instance with:

- Ubuntu Server 24.04 LTS
- `t3.small`
- 20 GB storage if available
- public IP enabled

Security group inbound rules:

- `SSH` on port `22` from `My IP`
- `Custom TCP` on port `8080` from `0.0.0.0/0`

## Windows Commands

Replace the key path if your `.pem` file is somewhere else.

### 1. Connect to the server

```powershell
ssh -i "C:\Users\Rithvik Reddy\Downloads\shardworld-server-key.pem" ubuntu@YOUR_PUBLIC_IP
```

### 2. Upload the latest project

Run this from Windows PowerShell, not from inside the server:

```powershell
scp -i "C:\Users\Rithvik Reddy\Downloads\shardworld-server-key.pem" -r "C:\Users\Rithvik Reddy\Desktop\Distributed-Systems-Project-main" ubuntu@YOUR_PUBLIC_IP:~/
```

## EC2 Server Commands

After SSHing into the EC2 machine:

```bash
cd ~/Distributed-Systems-Project-main
make up
```

If `make` is not installed yet:

```bash
sudo apt update
sudo apt install -y make
```

## Verification

Run these on the EC2 server:

```bash
make ps
make health
PUBLIC_HOST=YOUR_PUBLIC_IP make urls
```

Expected public links:

- Player: `http://YOUR_PUBLIC_IP:8080`
- Admin: `http://YOUR_PUBLIC_IP:8080/admin`

## Live Demo Tabs

Keep these open:

- player page
- admin page
- SSH terminal with:

```bash
make logs-gateway
```

## If Something Looks Wrong

Restart the stack:

```bash
make restart
```

Check all logs:

```bash
make logs
```

Check container status:

```bash
make ps
```

## After The Presentation

Stop the app:

```bash
make down
```

Then stop or terminate the EC2 instance in AWS Learner Lab.
