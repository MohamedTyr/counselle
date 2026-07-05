import type { Activity, Honor } from "@/domain/activity"
import { demoActivityNowIso } from "@/domain/time"

export const todayIso = demoActivityNowIso

export const initialActivities: Activity[] = [
  {
    id: "robotics-founder",
    order: 1,
    type: "Robotics",
    position: "Founder & President",
    organization: "Robotics Club, Al-Noor High School",
    description:
      "Led 12-member team to national finals; built the training program that runs every season.",
    grades: ["10", "11", "12"],
    timing: ["school_year"],
    hours_per_week: 12,
    weeks_per_year: 30,
    continue_in_college: true,
    story:
      "Started the club in Grade 10 with three friends and one borrowed kit. Wrote the 6-week training curriculum we still use, mentored two rookie teams, and raised the entry fee through a school fair. We placed 2nd nationally in 2025 out of 40 teams. The part I'd write an essay about: teaching a shy Grade-9 student to solder, and watching her run the electronics bench a year later.",
    created_at: "2026-06-12T09:00:00",
    updated_at: "2026-07-01T18:20:00",
  },
  {
    id: "refugee-tutor",
    order: 2,
    type: "Community Service (Volunteer)",
    position: "Volunteer Tutor",
    organization: "Ma'an Refugee Learning Center",
    // Intentionally empty: shows the "missing description" state in the list.
    description: "",
    grades: ["11", "12"],
    timing: ["all_year"],
    hours_per_week: 4,
    weeks_per_year: 45,
    continue_in_college: false,
    story:
      "Tutor math and English to 8-12 year olds on Saturday mornings. Most are Syrian and Sudanese, learning in a third language. I built a picture-based fractions worksheet that the center now reuses. Numbers I want to pin down before writing the entry: ~40 students over two years, attendance up after we added snacks.",
    created_at: "2026-05-30T10:00:00",
    updated_at: "2026-06-28T14:05:00",
  },
  {
    id: "physics-research",
    order: 3,
    type: "Research",
    position: "Research Intern",
    organization: "Department of Physics, National University",
    // Intentionally over the 150-char limit: shows the "over limit" state.
    description:
      "Ran spectroscopy measurements and cleaned the dataset for a graduate study on thin-film solar cells, then co-wrote the methods section that went into the lab's summer report.",
    grades: ["11", "12"],
    timing: ["break"],
    hours_per_week: 20,
    weeks_per_year: 8,
    continue_in_college: true,
    story:
      "Eight-week summer internship after Grade 11. Learned to run the UV-Vis spectrometer, calibrated it daily, and wrote a short Python script to batch-clean the CSVs. My name is in the acknowledgements of the internal report. This is the strongest 'I can do real research' evidence I have.",
    created_at: "2026-06-18T11:30:00",
    updated_at: "2026-07-02T09:15:00",
  },
  {
    id: "student-council",
    order: 4,
    type: "Student Govt./Politics",
    position: "Vice President",
    organization: "Student Council, Al-Noor High School",
    // ~140 chars: shows the amber "near limit" state.
    description:
      "Ran the weekly student forum, negotiated a later library close time with admin, and organized the two largest school fundraisers of the year.",
    grades: ["10", "11"],
    timing: ["school_year"],
    hours_per_week: 3,
    weeks_per_year: 32,
    continue_in_college: false,
    story:
      "Elected VP in Grade 10, re-elected in Grade 11. The library hours win took three meetings and a petition with 200 signatures. Fundraisers cleared roughly $1,800 combined for the science lab.",
    created_at: "2026-06-14T13:00:00",
    updated_at: "2026-06-30T16:40:00",
  },
  {
    id: "youth-orchestra",
    order: 5,
    type: "Music: Instrumental",
    position: "Lead Violinist",
    organization: "City Youth Orchestra",
    description:
      "First-chair violin; performed 6 concerts a year and mentored the junior string section.",
    grades: ["9", "10", "11", "12"],
    timing: ["all_year"],
    hours_per_week: 5,
    weeks_per_year: 40,
    continue_in_college: true,
    story:
      "Auditioned in for second violin in Grade 9, moved to first chair by Grade 11. Four years of consistency is the point here - it shows commitment, not just a title.",
    created_at: "2026-06-11T08:30:00",
    updated_at: "2026-06-26T19:10:00",
  },
  {
    id: "weekend-barista",
    order: 6,
    type: "Work (Paid)",
    position: "Barista",
    organization: "Rawabi Coffee House",
    description:
      "Weekend shifts to help with family expenses; trained two new hires on the till and espresso bar.",
    grades: ["11", "12"],
    timing: ["school_year", "break"],
    hours_per_week: 10,
    weeks_per_year: 40,
    continue_in_college: false,
    story:
      "Paid work matters for the financial-aid story. I hand most of what I earn to my family. Learned to close the shop alone, handle cash, and stay calm during the morning rush.",
    created_at: "2026-06-15T07:45:00",
    updated_at: "2026-06-29T12:00:00",
  },
  {
    id: "debate-captain",
    order: 7,
    type: "Debate/Speech",
    position: "Team Captain",
    organization: "Al-Noor Debate Society",
    description:
      "Captained the debate team to the regional semifinals and coached novices in cross-examination.",
    grades: ["10", "11", "12"],
    timing: ["school_year"],
    hours_per_week: 6,
    weeks_per_year: 28,
    continue_in_college: false,
    story:
      "Three years of debate. As captain I ran Tuesday practice, built the case files, and drilled the younger students on rebuttals. We reached regional semifinals in 2025.",
    created_at: "2026-06-13T15:20:00",
    updated_at: "2026-06-27T10:30:00",
  },
]

export const initialHonors: Honor[] = [
  {
    id: "physics-olympiad",
    order: 1,
    title: "National Physics Olympiad - Silver Medal",
    grades: ["11"],
    levels: ["national", "state_regional"],
    created_at: "2026-06-12T09:10:00",
    updated_at: "2026-06-30T17:00:00",
  },
  {
    id: "principals-list",
    order: 2,
    title: "Principal's Honor List",
    grades: ["10", "11", "12"],
    levels: ["school"],
    created_at: "2026-06-12T09:12:00",
    updated_at: "2026-06-30T17:02:00",
  },
  {
    id: "science-fair",
    order: 3,
    title: "Regional Science Fair - 1st Place",
    grades: ["10"],
    levels: ["state_regional"],
    created_at: "2026-06-12T09:14:00",
    updated_at: "2026-06-30T17:04:00",
  },
]
