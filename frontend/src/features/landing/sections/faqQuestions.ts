export type Audience = "students" | "schools";

/** The two groups the FAQ filters between, in the order the switch shows them. */
export const FAQ_AUDIENCES: { id: Audience; label: string }[] = [
  { id: "students", label: "Students" },
  { id: "schools", label: "Schools & counselors" },
];

/** The questions the FAQ shows, and the FAQPage structured data repeats. */
export const QUESTIONS: { audience: Audience; q: string; a: string }[] = [
  {
    audience: "students",
    q: "Why not just ask ChatGPT?",
    a: "ChatGPT is a general-purpose chatbot. It pulls from outdated sources, isn’t trained to say “I don’t know,” and doesn’t have access to the same data Acceptra uses. Acceptra reads directly from official college-reported data, refreshes it daily, and shows you the source every time. It also remembers you: your grades, your school list, your drafts, your deadlines. You never start from a blank chat.",
  },
  {
    audience: "students",
    q: "Does Acceptra write the essay for me?",
    a: "No. It reads your draft and leaves notes, and you can accept or reject each note. The words stay yours, which is also what colleges and the Common App require.",
  },
  {
    audience: "students",
    q: "Where does the school data come from?",
    a: "Four sources: IPEDS (the US Department of Education’s database of every accredited college), CollegeData (refreshed daily), each college’s official website, and the wider internet. Acceptra only mentions facts when it can show its source. When a fact isn’t available, Acceptra tells you so.",
  },
  {
    audience: "students",
    q: "Can it tell me my chances?",
    a: "It can tell you where you stand. Acceptra compares your grades and scores with each college’s reported admit data and sorts your list into reach, target, and safety. Nobody can promise an admission, as no one is the university.",
  },
  {
    audience: "students",
    q: "I’m only in 9th or 10th grade. Is it too early?",
    a: "It’s the best time. Freshman and sophomore year is when you choose the courses, activities, and summers that your application will be built from. Acceptra suggests programs and competitions that fit what you already love, so junior year isn’t a scramble.",
  },
  {
    audience: "students",
    q: "What does /goal do?",
    a: "Type /goal and say what you want in plain words, like “Get me into Georgia Tech for engineering” or “Find schools under $30k with strong biology.” Acceptra turns it into a plan: a list, the deadlines for each school, the essays each one asks for, and a to-do list in the right order.",
  },
  {
    audience: "students",
    q: "Is there a real person, or only AI?",
    a: "Both! The workspace is AI. Monthly and Season plans include live sessions with a real person. Questions to support are answered by a person within a day.",
  },
  {
    audience: "students",
    q: "I’m applying from outside the US. Does it work for me?",
    a: "Yes. Many of our first students are international students. Acceptra covers US colleges in depth, including the things international applicants trip on: test policies, English proficiency, and which schools offer aid to international students.",
  },
  {
    audience: "students",
    q: "Does it support universities outside the US?",
    a: "Yes! While our school data (admit rates, test policies, costs, and deadlines) mainly covers US colleges today, everything else works wherever you apply: feedback on your UCAS personal statement or any other essay, your deadlines and tasks, activities, and summer programs. Applying to the UK, Canada, or Europe as well as the US? Keep it all in one workspace.",
  },
  {
    audience: "students",
    q: "Can I cancel, and is there a free plan?",
    a: "Yes to both. The Free plan needs no card. Monthly can be cancelled any time and runs to the end of the billing month. Season is a one-time payment for four months. Full refund within 7 days of your first payment if you haven’t used a counselor session.",
  },
  {
    audience: "schools",
    q: "Does it replace our school counselors?",
    a: "No. It answers the routine questions like deadlines, requirements, and test policies, so counselors get their hours back for the advising only they can do. Counselors can see every student’s progress and comment on their work. We built it with more than 30 renowned counselors from top US and international high schools.",
  },
  {
    audience: "schools",
    q: "What can a counselor see?",
    a: "Your school counselors and administrators can see and track each student’s documents and submission status, college list, deadlines, task status, and overall progress. The dashboard surfaces the students who are falling behind at the top, so counselors can give targeted help where it matters most. Counselors can comment on any essay, but only if the student chooses to share it. Private chats between the student and the agent are never visible to anyone.",
  },
  {
    audience: "schools",
    q: "How much does it cost for a school?",
    a: "It’s priced per student per year, with founding-school rates for our first partners. Book a 15-minute walkthrough and we’ll show it running on your own college list, then send a quote.",
  },
  {
    audience: "schools",
    q: "Can we try it before we commit?",
    a: "Yes. Start with one grade or one counselor’s caseload and see how students use it.",
  },
];
