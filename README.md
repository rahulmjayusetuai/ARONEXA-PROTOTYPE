<div align="center">

# AroNexa

### Bridging healthcare with intelligence

See every patient's full story. Explain it in their language.

**[Open the live prototype →](https://aronexa-prototype.vercel.app)**

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Languages](https://img.shields.io/badge/Languages-English_%7C_Malayalam-14B8A6?style=flat-square)

<br />

<img src="docs/screenshots/doctor-body-map.png" alt="Doctor view of a patient's body map, showing heart records, vitals and lab results" width="900" />

</div>

<br />

AroNexa is a clickable healthcare prototype with two connected sides: a workspace for doctors and an app for their patients. Records are organised around an interactive body map, so a doctor can click an organ, see its reports, and explain the results in English or Malayalam.

> [!NOTE]
> This is a frontend-only prototype for computer screens. There is no backend, every patient and doctor is made up, and it is not for real medical use.

## Features

<table>
<tr>
<th width="50%">For doctors</th>
<th width="50%">For patients</th>
</tr>
<tr valign="top">
<td>

- **Home page:** today's patients, alerts and billing at a glance
- **Calendar:** any month or day, blocked time and leave
- **Patient record:** overview, timeline, medicines and allergies
- **Body map:** click an organ to see its reports and tests
- **Scans and reports:** compare results side by side
- **Explain to patient:** clear summaries in English and Malayalam
- **Clinical notes, labs and documents:** with PDF downloads
- **Billing:** collect payments, print receipts, export CSV

</td>
<td>

- **Find care:** search for doctors and clinics, then book a visit
- **Live queue:** follow your place on the day of a visit
- **Appointments:** book, move or cancel
- **My body:** the same body map, in plain language
- **Reports and scans:** with explanations from your doctor
- **Medicines and lab tests:** all in one place
- **Bills, records and sharing:** pay, download and share
- **Family and emergency:** profiles for relatives, help in one click

</td>
</tr>
</table>

## A look inside

<table>
<tr>
<td width="50%"><img src="docs/screenshots/doctor-home.png" alt="Doctor home page with today's patients, alerts and billing" /></td>
<td width="50%"><img src="docs/screenshots/patient-home.png" alt="Patient home page with doctor search, upcoming visits and an explained report" /></td>
</tr>
<tr>
<td align="center"><b>Doctor home</b></td>
<td align="center"><b>Patient home</b></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/sign-in.png" alt="Sign-in page with doctor and patient tabs and a language switch" /></td>
<td width="50%"><img src="docs/screenshots/patient-body-map.png" alt="Patient view of the body map with heart records" /></td>
</tr>
<tr>
<td align="center"><b>Sign in</b></td>
<td align="center"><b>Patient body map</b></td>
</tr>
</table>

## Run it locally

You'll need [Node.js](https://nodejs.org) 20.9 or later.

```bash
git clone https://github.com/rahulmjayusetuai/ARONEXA-PROTOTYPE.git
cd ARONEXA-PROTOTYPE
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Sign in**, as the details are already filled in. To see the other side, choose the **Patient** tab first. Each side offers a short, skippable tour on your first visit.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Builds the production site |
| `npm start` | Serves the production build |
| `npm run lint` | Checks the code with ESLint |

## How it works

Each screen is stored as data and drawn as HTML in the browser. A separate layer adds the working behaviour on top.

```mermaid
flowchart LR
    A["Screen data<br/>public/design"] --> B["Screen renderer<br/>src/design"]
    C["Working behaviour<br/>src/design/live"] --> B
    D["Session state<br/>Zustand"] <--> C
    B --> E["Doctor app<br/>/doctor"]
    B --> F["Patient app<br/>/patient"]
    E <-. "syncs across tabs" .-> F
```

| Path | What it holds |
| --- | --- |
| `src/app/` | Pages and routes for `/doctor` and `/patient` |
| `src/design/DesignApp.tsx` | The app shell: current screen, pop-ups and transitions |
| `src/design/Node.tsx` | Draws one layer of a screen as HTML |
| `src/design/store.ts` | Navigation, pop-ups, typed values and control states |
| `src/design/live/` | Forms, filters, the calendar, downloads, billing and the tour |
| `public/design/` | Screen data, images and vector graphics |
| `public/video/` | ECG explainer videos in English and Malayalam |

## Good to know

- **Sample date:** "today" is always Thursday, 15 May 2025, to match the sample data.
- **Saved changes:** anything you change lasts until the browser tab closes.
- **Simulated actions:** messages, calls, lab orders and council checks don't reach anyone.
- **Screen size:** it's designed for computers, and phone layouts aren't included.

