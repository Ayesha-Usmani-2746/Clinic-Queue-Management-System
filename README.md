<div align="center">

# Clinic Queue Management System

A full-stack web application for patient registration, appointment scheduling, and queue management.

**HTML • CSS • JavaScript • Python • Flask • Supabase • Vercel • Render**

</div>

---

## Overview

The Clinic Queue Management System is a full-stack web application designed to streamline clinic operations by automating patient registration, appointment scheduling, token generation, and queue management. The application provides an intuitive interface for patients and administrators while using Supabase as the cloud database and Flask as the backend framework.

---

## Features

### Patient Module

- Patient registration
- Walk-in patient registration
- Appointment booking
- Automatic token generation
- Queue tracking

### Administrator Module

- Secure administrator login
- Patient management
- Appointment management
- Queue monitoring
- Status updates

### Queue Management

- Automatic token generation
- Queue assignment
- Patient calling
- Completed queue tracking

### WhatsApp Integration

- WhatsApp appointment requests
- Queue notifications
- Automated messaging using Twilio

---

## Technology Stack

| Category | Technologies |
|-----------|--------------|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Python, Flask |
| Database | Supabase |
| Deployment | Vercel, Render |
| Integration | Twilio WhatsApp API |

---

## Project Structure

```text
Clinic-Queue-Management-System
│
├── backend/
├── frontend/
├── database/
├── screenshots/
├── .env.example
├── README.md
└── requirements.txt
```

---

## Installation

Clone the repository

```bash
git clone https://github.com/Ayesha-Usmani-2746/Clinic-Queue-Management-System.git
```

Go to the project directory

```bash
cd Clinic-Queue-Management-System
```

Create a virtual environment

```bash
python -m venv venv
```

Activate the environment

Windows

```bash
venv\Scripts\activate
```

Linux/macOS

```bash
source venv/bin/activate
```

Install dependencies

```bash
pip install -r requirements.txt
```

Run the application

```bash
python app.py
```

---

## Environment Variables

Create a `.env` file inside the backend folder.

```env
SUPABASE_URL=
SUPABASE_KEY=
SECRET_KEY=
JWT_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
PORT=5000
```

---

---

## Deployment

The application is deployed using modern cloud hosting platforms.

| Component | Platform | Description |
|-----------|----------|-------------|
| Frontend | **Vercel** | Hosts the user interface built with HTML, CSS, and JavaScript. |
| Backend | **Render** | Hosts the Flask REST API and server-side logic. |
| Database | **Supabase** | Cloud PostgreSQL database used for storing patients, appointments, queue data, and administrator information. |

### Live Application

**Frontend (Vercel)**

[https://your-vercel-url.vercel.app](https://digital-clinic-queue.vercel.app/)

**Backend API (Render)**

[https://your-render-url.onrender.com](https://digital-clinic-queue.onrender.com/)


---

## Screenshots

screenshots of the project  are  inside the `screenshots` folder.

```
screenshots/
├── Admin.png
├── appoinment.png
├── home.png
├── queue.png
└── token.png
```

---

## Future Improvements

- Email notifications
- SMS notifications
- Doctor scheduling
- Analytics dashboard
- Multi-clinic support
- Patient portal

---

## Developer

**Ayesha Usmani**

GitHub: https://github.com/Ayesha-Usmani-2746


---

## License

This project is intended for educational and portfolio purposes.
