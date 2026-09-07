"""Unmatched crosswalk adjudication decisions -- no plausible Title-IV IPEDS
row (small/niche/unaccredited/closed institutions, declines-Title-IV-by-
policy schools, and the handful the plan itself (§4.6) already names as
unmatchable). Split out of ``crosswalk_adjudication.py`` to keep both files
under the 800-line guideline; ``crosswalk_adjudication.py`` merges this with
``crosswalk_adjudication_matched.py`` into the one ``ADJUDICATED`` mapping
``scripts/build_crosswalk.py merge`` consumes.
"""

from __future__ import annotations

# slug -> (None, note)
UNMATCHED: dict[str, tuple[int | None, str]] = {
    # --- No plausible IPEDS candidate (small/niche/unaccredited/closed) ---
    "American-Business-Technology-University": (
        None,
        "no plausible IPEDS candidate in Saint Joseph, MO",
    ),
    "American-Islamic-College": (None, "plan §4.6: confirmed no Title-IV IPEDS row"),
    "Aquinas-College-Nashville-TN": (None, "no Aquinas-named IPEDS row in TN; likely closed"),
    "Ashworth-College": (None, "not Title-IV/IPEDS accredited (DEAC-only online school)"),
    "Baptist-Bible-College": (None, "no Baptist Bible-named IPEDS row in Missouri"),
    "Bay-Atlantic-University": (None, "no plausible IPEDS candidate in Washington DC"),
    "Bayamon-Central-University": (
        None,
        "nearest candidates (Caribbean University-Bayamon, UPR-Bayamon) are different institutions",
    ),
    "Connecticut-State-Community-College": (
        None,
        "the 2023 CT community-college merger has no IPEDS row in this seed",
    ),
    "Culinary-Institute-of-Virginia": (None, "division of ECPI with no own IPEDS row (appendix v)"),
    "Istituto-Marangoni-Miami": (None, "no plausible IPEDS candidate"),
    "Judson-College-at-Southeastern": (
        None,
        "uncertain relationship to Southeastern Free Will Baptist Bible College; unconfirmed",
    ),
    "Lakewood-University": (None, "no plausible IPEDS candidate in Cleveland Heights, OH"),
    "Bergin-College-of-Canine-Studies": (None, "niche canine-studies school, no IPEDS row"),
    "Bethlehem-College-Seminary": (None, "no plausible IPEDS candidate in Minneapolis"),
    "Beverly-Hills-Design-Institute": (None, "no plausible IPEDS candidate"),
    "Bottega-University": (None, "no plausible IPEDS candidate; online-only"),
    "California-Coast-University": (None, "no plausible IPEDS candidate; online for-profit"),
    "California-Northstate-University": (None, "no IPEDS row found for this name"),
    "California-University-of-Management-and-Sciences": (None, "no plausible IPEDS candidate"),
    "Capital-Health-School-of-Radiologic-Technology": (
        None,
        "tiny specialized program, no IPEDS row",
    ),
    "Carver-College": (None, "no plausible IPEDS candidate in Atlanta"),
    "Casa-Loma-College-Nashville-Nashville-TN": (None, "no plausible IPEDS candidate"),
    "Centura-College-Virginia-Beach": (
        None,
        "shortlist candidate (Bryant & Stratton) is an unrelated brand",
    ),
    "Charter-College-Vancouver": (None, "no plausible IPEDS candidate in Vancouver, WA"),
    "Christendom-College": (None, "no plausible IPEDS candidate"),
    "College-of-Athens": (None, "no plausible IPEDS candidate in Watkinsville, GA"),
    "Columbia-College-Denver": (
        None,
        "no strong evidence this is a Columbia College (MO) satellite",
    ),
    "Columbia-College-Elgin": (
        None,
        "ambiguous: could be Columbia College MO or unrelated, no strong signal",
    ),
    "Columbia-College-Fort-Worth": (None, "not a known military-base site; ambiguous affiliation"),
    "Columbia-College-Freeport": (
        None,
        "ambiguous: could be Columbia College MO or unrelated, no strong signal",
    ),
    "Columbia-College-Imperial": (None, "no evidence of Columbia College (any state) affiliation"),
    "Curtis-Institute-of-Music": (None, "no plausible IPEDS candidate in Philadelphia"),
    "Dharma-Realm-Buddhist-University": (None, "tiny institution, no plausible IPEDS candidate"),
    "Doral-College": (None, "plan §4.6: confirmed no Title-IV IPEDS row"),
    "Dunlap-Stone-University": (None, "no plausible IPEDS candidate; online for-profit"),
    "EC-Council-University": (None, "no plausible IPEDS candidate; online for-profit"),
    "Empire-College": (None, "no plausible IPEDS candidate in Santa Rosa, CA"),
    "Florida-Technical-College": (
        None,
        "shortlist candidate (Florida College) is a different, unrelated school",
    ),
    "Gemini-School-of-Visual-Arts-Communication": (None, "tiny art school, no IPEDS row"),
    "Global-University": (None, "plan §4.6: confirmed no Title-IV IPEDS row"),
    "Grove-City-College": (None, "declines Title IV funding by policy; not in IPEDS"),
    "Gutenberg-College": (None, "tiny college, no plausible IPEDS candidate"),
    "Hellenic-American-University": (None, "no plausible US Title-IV IPEDS record"),
    "Herzing-University-Online": (
        None,
        "Herzing has no flagship/online-specific unitid; only per-city ones",
    ),
    "Hillsdale-College": (None, "declines Title IV funding by policy; not in IPEDS"),
    "Holy-Trinity-Orthodox-Seminary": (None, "no plausible IPEDS candidate"),
    "INSTE-Global-Bible-College": (None, "tiny bible college, no IPEDS row"),
    "Indiana-University-Columbus": (None, "no separate IPEDS row for this IU regional site"),
    "Indiana-University-Fort-Wayne": (
        None,
        "IU Fort Wayne merged into Purdue Fort Wayne (2018), no current separate row",
    ),
    "Learnet-Academy": (None, "no plausible IPEDS candidate"),
    "Lincoln-University-California": (
        None,
        "distinct small institution; no matching Lincoln-named IPEDS row",
    ),
    "MIU-City-University-Miami": (None, "no plausible IPEDS candidate"),
    "Macaulay-Honors-College": (
        None,
        "CUNY honors program spanning colleges, not a separate IPEDS institution",
    ),
    "Maple-Springs-Baptist-Bible-College-and-Seminary": (None, "no plausible IPEDS candidate"),
    "Mid-America-Baptist-Theological-Seminary": (None, "no plausible IPEDS candidate"),
    "Midwest-University": (
        None,
        "ambiguous vs. Urshan University/Urshan Graduate School at same address",
    ),
    "Minerva-University": (None, "distributed/online model, no confident IPEDS candidate"),
    "Montana-Bible-College": (None, "no plausible IPEDS candidate"),
    "Multnomah-University": (None, "no confident single candidate in Portland, OR"),
    "NUC-University-Florida-Technical-College-Cutler-Bay": (
        None,
        "NUC's only unitid is its Bayamon PR campus; no FL row",
    ),
    "NUC-University-Florida-Technical-College-Deland": (
        None,
        "NUC's only unitid is its Bayamon PR campus; no FL row",
    ),
    "NUC-University-Florida-Technical-College-Kissimmee": (
        None,
        "NUC's only unitid is its Bayamon PR campus; no FL row",
    ),
    "NUC-University-Florida-Technical-College-Lakeland": (
        None,
        "NUC's only unitid is its Bayamon PR campus; no FL row",
    ),
    "NUC-University-Florida-Technical-College-Pembroke-Pines": (
        None,
        "NUC's only unitid is its Bayamon PR campus; no FL row",
    ),
    "National-College-of-Midwifery": (None, "tiny specialized program, no IPEDS row"),
    "National-Intelligence-University": (
        None,
        "federal DoD institution, not in the Title-IV IPEDS universe",
    ),
    "National-Paralegal-College": (None, "no plausible IPEDS candidate; online for-profit"),
    "National-University-College-Arecibo": (None, "no exact-city NUC unitid (only Bayamon exists)"),
    "National-University-College-Caguas": (None, "no exact-city NUC unitid (only Bayamon exists)"),
    "National-University-College-Ponce": (None, "no exact-city NUC unitid (only Bayamon exists)"),
    "NationsUniversity": (None, "no plausible IPEDS candidate; online"),
    "New-Hampshire-Institute-of-Art": (
        None,
        "merged into New England College years ago; no current separate row",
    ),
    "New-Saint-Andrews-College": (None, "no plausible IPEDS candidate"),
    "New-World-School-of-the-Arts": (
        None,
        "no separate IPEDS row (operates jointly with Miami Dade College)",
    ),
    "New-York-College-of-Health-Professions": (None, "no plausible IPEDS candidate"),
    "NewU-University": (None, "no plausible IPEDS candidate"),
    "Ohr-Somayach-Tanenbaum-Educational-Center": (
        None,
        "small yeshiva, no plausible IPEDS candidate",
    ),
    "Pace-University-Westchester-Campus": (None, "no exact-city IPEDS row for this Pace satellite"),
    "Pacific-Northwest-College-of-Art": (
        None,
        "merged into Willamette University (2020), no current separate row",
    ),
    "Pathways-College": (None, "no plausible IPEDS candidate"),
    "Patrick-Henry-College": (None, "plan §4.6: confirmed no Title-IV IPEDS row"),
    "Pennsylvania-College-of-Health-Sciences": (None, "no confident current IPEDS row identified"),
    "Pensacola-Christian-College": (None, "declines Title IV funding by policy; not in IPEDS"),
    "Principia-College": (None, "no IPEDS row found for this name"),
    "Reformed-University": (None, "plan §4.6: confirmed no Title-IV IPEDS row"),
    "Rio-Grande-Bible-Institute": (None, "tiny bible institute, no IPEDS row"),
    "Saint-Lukes-College-of-Nursing-and-Health-Sciences": (
        None,
        "shortlist candidate is a different, unrelated nursing school",
    ),
    "San-Francisco-Bay-University": (None, "no IPEDS row found for this name"),
    "Sattler-College": (None, "no plausible IPEDS candidate"),
    "Selma-University": (None, "no IPEDS row found; known accreditation gaps"),
    "Southern-Baptist-Theological-Seminary": (None, "no IPEDS row found in seed"),
    "Southern-California-Leadership-University": (None, "no IPEDS row found for this name"),
    "Southern-Technical-College": (None, "no plausible IPEDS candidate in Fort Myers, FL"),
    "Southwest-University": (None, "no plausible IPEDS candidate in Kenner, LA"),
    "Southwestern-Baptist-Theological-Seminary": (
        None,
        "graduate-only; no IPEDS row in seed (appendix v)",
    ),
    "St-Gregory-the-Great-Seminary": (None, "no plausible IPEDS candidate"),
    "St-Herman-Theological-Seminary": (None, "no plausible IPEDS candidate"),
    "The-Colburn-School-Conservatory-of-Music": (None, "no plausible IPEDS candidate"),
    "The-Crown-College": (None, "no plausible IPEDS candidate in Powell, TN"),
    "The-North-Coast-College": (None, "no plausible IPEDS candidate in Lakewood, OH"),
    "The-SANS-Technology-Institute": (None, "no plausible IPEDS candidate"),
    "The-University-of-America": (None, "no plausible IPEDS candidate"),
    "Theological-University-of-the-Caribbean": (None, "no plausible IPEDS candidate"),
    "Thomas-Aquinas-College-New-England": (
        None,
        "no MA-specific row; the CA institution is a different campus/coast",
    ),
    "Touro-College-Los-Angeles": (None, "no plausible IPEDS candidate among Touro system entries"),
    "Trident-University-International": (None, "no IPEDS row found for this name"),
    "URBE-University": (None, "no plausible IPEDS candidate"),
    "United-International-College": (None, "no plausible IPEDS candidate"),
    "University-College-of-San-Juan": (
        None,
        "genuinely tied shortlist (two candidates, both sim=0.51)",
    ),
    "University-of-Alaska-Prince-William-Sound-College": (
        None,
        "not separately listed; too ambiguous among 4 UA system rows",
    ),
    "University-of-Arizona-Global-Campus": (
        None,
        "no IPEDS row found in seed (possibly under a former name)",
    ),
    "University-of-Maine-at-Machias": (
        None,
        "merged into UMaine Presque Isle (2019), no current separate row",
    ),
    "University-of-Mississippi-Medical-Center": (None, "no IPEDS row found in seed"),
    "University-of-the-People-Pasadena-CA": (None, "no IPEDS row found in seed"),
    "West-Coast-Baptist-College": (None, "no plausible IPEDS candidate"),
    "West-Coast-Ultrasound-Institute": (None, "no plausible IPEDS candidate"),
    "Western-Technical-College-Diana-Campus": (
        None,
        "two identically-named El Paso IPEDS rows (224660/224679); cannot tell which is which",
    ),
    "Western-Technical-College-El-Paso-Campus": (
        None,
        "two identically-named El Paso IPEDS rows (224660/224679); cannot tell which is which",
    ),
    "Yellowstone-Christian-College": (None, "no plausible IPEDS candidate"),
    "Yeshivat-Mikdash-Melech": (None, "small yeshiva, no plausible IPEDS candidate"),
    "Zaytuna-College": (None, "no IPEDS row found in seed"),
}
