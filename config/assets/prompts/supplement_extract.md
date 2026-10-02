You read one university's supplemental essay section, copied from a public list of {cycle} first-year application prompts, and return its prompts as structured data. The heading names the university, and sometimes a part of it (an honors college, a school or a program).

Every text you return in `prompt` and `context` is copied from the block exactly — same words, same order, same punctuation. Never paraphrase, shorten, fix or add words, and never stitch together text that is not contiguous in the block.

- `prompt`: the question the student answers. When the question is introduced by sentences directly before it that belong to it, copy the introduction and the question together as one contiguous passage. Leave out word-limit lines ("Max. 250 words") and labels such as "Essay Prompt 1" or "A.".
- `context`: only when the question refers to separate text the student must see to answer it — a quotation, a passage, a scenario — that is printed apart from the question (for example a quotation, then an attribution line, then the question). Copy that text, as one contiguous passage, into `context`; otherwise null. Never repeat the prompt in it.
- When the block names a question without printing a longer prompt (for example an optional 250-word response to "Why W&L?"), the named question, as printed, is the prompt.

Include every question a student answers: essays, short answers and quick questions phrased as questions, required or optional, and ones only some applicants answer. Leave out:
- Fill-in labels that are not questions ("Dream job:", "Favorite book:"), lists of songs, the items of a "top 5" list, picking majors from a list. (A question asking the student to explain such a list is a prompt.)
- Pure instructions with no question (word-count rules, AI policies, "choose one of the following").
- Uploads of existing work (graded papers, portfolios, images) and Common App personal statement prompts.

Choices — only when the student picks which of several prompts to answer:
- `group`: the block's instruction for choosing, as written. Every prompt in one choice shares the same `group`; two separate choices must never share one — if their instructions read the same, start each `group` with its question number or title (for example "Question 2: Respond to one of the following…").
- When the options sit under a shared introduction (a question, then lettered or titled options), that introduction is the `group`, and each option — its title line and its text — is one prompt; never put the introduction into the prompts.
- `choose_count`: how many the student answers ("up to two" is 2); null when the block allows any number.
- Prompts written for different colleges, schools, majors or programs, where each applicant answers only the one for their own program, are NOT a choice: leave `group` null and set `applies_to`. The same for prompts that depend on the applicant's situation ("If you selected YES…", "If you have had a gap in your education…").

Fields:
- `requirement`: `optional` when the block says the prompt — or the whole choice, or the whole section — is optional; otherwise `required`. Prompts in one choice share one requirement.
- `word_limit`: the maximum in words the block states for that prompt, or explicitly for every prompt in the section; "approximately 250 words" is 250 and a range is its maximum. Never carry a limit stated for one question onto another, never convert a character limit, never guess; otherwise null.
- `applies_to`: who answers the prompt when not every first-year applicant to this university — the program ("Honors College applicants", "College of Engineering applicants") or the condition ("Applicants who have had a gap in their education"). Otherwise null. Which application platform the student uses (Common App, Coalition, the school's own application) is not a condition: leave it null.

Return an empty `prompts` list when the block contains no prompt.
