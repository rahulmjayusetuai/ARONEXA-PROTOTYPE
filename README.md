<div align="center">

<img src="docs/readme/banner.svg" alt="AroNexa. See every patient's full story. Explain it in their language." width="100%" />

<br /><br />

<a href="https://aronexa-prototype.vercel.app"><img src="https://img.shields.io/badge/Open_the_live_prototype-14B8A6?style=for-the-badge&logoColor=white" alt="Open the live prototype" /></a>

<br /><br />

![Next.js](https://img.shields.io/badge/Next.js-16-031C54?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-031C54?style=flat-square&logo=react&logoColor=C7FFEB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-031C54?style=flat-square&logo=typescript&logoColor=C7FFEB)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-031C54?style=flat-square&logo=tailwindcss&logoColor=C7FFEB)
![Languages](https://img.shields.io/badge/English_%2B_Malayalam-14B8A6?style=flat-square)

</div>

<br />

AroNexa is a clickable healthcare prototype with two connected sides: a workspace for doctors and an app for their patients. Records are organised around an interactive body map, so a doctor can click an organ, see its reports, and explain the results in English or Malayalam.

<img src="docs/readme/highlights.svg" alt="Highlights: body map, scan comparison, explanations in English and Malayalam, and a live queue." width="100%" />

> [!NOTE]
> This is a frontend-only prototype for computer screens. There is no backend, every patient and doctor is made up, and it is not for real medical use.

<div align="center"><img src="docs/readme/divider.svg" alt="" width="70%" /></div>

## See it in motion

These are recordings of the real prototype.

### The doctor's day

Sign in, open a patient's record, and click through the body map.

<img src="docs/readme/doctor-flow.gif" alt="Recording of a doctor signing in, opening James Heatfield's record, and clicking the lungs and brain on the body map" width="100%" />

### The patient's side

Sign in, then check your body map, your place in the queue, and your appointments.

<img src="docs/readme/patient-flow.gif" alt="Recording of a patient signing in and moving through My body, Queue and Appointments" width="100%" />

<div align="center"><img src="docs/readme/divider.svg" alt="" width="70%" /></div>

## Features

<table>
<tr>
<th width="50%">🩺 For doctors</th>
<th width="50%">💙 For patients</th>
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

<details>
<summary><b>View more screenshots</b></summary>
<br />

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
<td width="50%"><img src="docs/screenshots/doctor-body-map.png" alt="Doctor view of a patient's body map, showing heart records, vitals and lab results" /></td>
<td width="50%"><img src="docs/screenshots/patient-body-map.png" alt="Patient view of the body map with heart records" /></td>
</tr>
<tr>
<td align="center"><b>Doctor body map</b></td>
<td align="center"><b>Patient body map</b></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/sign-in.png" alt="Sign-in page with doctor and patient tabs and a language switch" /></td>
</tr>
<tr>
<td colspan="2" align="center"><b>Sign in</b></td>
</tr>
</table>

</details>

<div align="center"><img src="docs/readme/divider.svg" alt="" width="70%" /></div>

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
