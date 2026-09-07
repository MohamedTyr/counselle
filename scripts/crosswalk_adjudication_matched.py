"""Matched crosswalk adjudication decisions -- CUNY senior colleges, renames/
punctuation drift, and multi-campus/multi-location collapse onto one shared
IPEDS unitid (see ``crosswalk_adjudication.py``'s docstring for the full
explanation of each pattern). Split out to keep both files under the
800-line guideline; ``crosswalk_adjudication.py`` merges this with
``crosswalk_adjudication_unmatched.py`` into the one ``ADJUDICATED`` mapping
``scripts/build_crosswalk.py merge`` consumes.
"""

from __future__ import annotations

# slug -> (unitid, note)
MATCHED: dict[str, tuple[int | None, str]] = {
    # --- CUNY senior colleges (trigram false-positives on "City University
    #     of New York" against unrelated NYC private schools; resolved by
    #     direct name lookup instead of the shortlist) ---
    "Baruch-College-City-University-of-New-York": (
        190512,
        "CUNY Bernard M Baruch College, direct name lookup",
    ),
    "Brooklyn-College-City-University-of-New-York": (
        190549,
        "CUNY Brooklyn College, direct name lookup",
    ),
    "City-College-of-New-York": (190567, "CUNY City College, direct name lookup"),
    "College-of-Staten-Island-City-University-of-New-York": (
        190558,
        "College of Staten Island CUNY, direct name lookup",
    ),
    "Lehman-College-City-University-of-New-York": (
        190637,
        "CUNY Lehman College, direct name lookup",
    ),
    "Medgar-Evers-College-City-University-of-New-York": (
        190646,
        "CUNY Medgar Evers College, direct name lookup",
    ),
    "Queens-College-City-University-of-New-York": (
        190664,
        "CUNY Queens College, direct name lookup",
    ),
    "York-College-City-University-of-New-York": (190691, "CUNY York College, exact city (Jamaica)"),
    "CUNY-School-of-Labor-and-Urban-Studies": (
        None,
        "no separate IPEDS unitid for this CUNY school",
    ),
    "CUNY-School-of-Medicine": (None, "no separate IPEDS unitid for this CUNY school"),
    "CUNY-School-of-Professional-Studies": (None, "no separate IPEDS unitid for this CUNY school"),
    # --- Renames / punctuation drift (name changed since the IPEDS snapshot) ---
    "Bard-College-at-Simons-Rock": (
        167792,
        "exact name match; CD's Barrytown NY address is stale, real location is Great Barrington",
    ),
    "Buffalo-State-College": (196130, "renamed SUNY Buffalo State University (2023)"),
    "College-of-Mount-St-Vincent": (
        193399,
        "renamed University of Mount Saint Vincent (2023), exact city",
    ),
    "Concordia-University-St-Paul": (
        173328,
        "punctuation variant of Concordia University-Saint Paul, sim=0.79",
    ),
    "Iona-University": (
        191931,
        "exact name match; CD's Baltimore MD address is erroneous, real location is New Rochelle",
    ),
    "Massachusetts-College-of-Pharmacy-and-Health-Sciences": (
        166656,
        "renamed MCPHS University, exact city (Boston)",
    ),
    "Tallahassee-Community-College": (
        137759,
        "renamed Tallahassee State College (2024), exact city",
    ),
    "University-of-Akron": (
        200800,
        "University of Akron Main Campus, exact city, CD omits the 'Main Campus' suffix",
    ),
    "University-of-Alabama": (100751, "The University of Alabama, sim=0.85, exact city"),
    "University-of-Tampa": (137847, "The University of Tampa, sim=0.87, exact city"),
    "University-of-St-Francis-Fort-Wayne-IN": (
        152336,
        "University of Saint Francis-Fort Wayne, 'St.'/'Saint' variant, exact city",
    ),
    "University-of-the-Sacred-Heart": (
        243443,
        "Universidad del Sagrado Corazon, exact Spanish translation, alias listed on the CD row",
    ),
    "Urshan-College": (494685, "Urshan University, likely renamed, exact city (Wentzville)"),
    "State-University-of-New-York-College-of-Agriculture-Technology-at-Morrisville": (
        196051,
        "SUNY Morrisville, exact city",
    ),
    "State-University-of-New-York-Maritime-College": (
        196291,
        "SUNY Maritime College, exact name, exact city",
    ),
    "State-University-of-New-York-Polytechnic-Institute": (
        196112,
        "SUNY Polytechnic Institute, exact name, exact city",
    ),
    "State-University-of-New-York-at-Canton": (
        196015,
        "official name is SUNY College of Technology at Canton, exact city",
    ),
    "State-University-of-New-York-at-Fredonia": (
        196158,
        "SUNY at Fredonia, near-exact name, exact city",
    ),
    # --- Multi-campus / multi-location collapse: one shared IPEDS unitid
    #     across several CollegeData campus slugs (see module docstring) ---
    "Arizona-State-University-at-the-Downtown-Phoenix-campus": (
        104151,
        "ASU Campus Immersion unitid covers all in-person ASU campuses (appendix v)",
    ),
    "Arizona-State-University-at-the-Polytechnic-campus": (
        104151,
        "ASU Campus Immersion unitid covers all in-person ASU campuses (appendix v)",
    ),
    "Arizona-State-University-at-the-West-campus": (
        104151,
        "ASU Campus Immersion unitid covers all in-person ASU campuses (appendix v)",
    ),
    "Arizona-College-Las-Vegas": (
        487375,
        "Arizona College of Nursing-Las Vegas, same chain, exact city",
    ),
    "Baker-College-Royal-Oak-Campus-Royal-Oak-MI": (
        168847,
        "Baker College's one surviving unitid (Owosso MI); multi-campus collapse",
    ),
    "Baker-College-of-Muskegon": (
        168847,
        "Baker College's one surviving unitid (Owosso MI); multi-campus collapse",
    ),
    "Bryant-Stratton-College-Akron-Campus": (
        201469,
        "only OH unitid is Parma; multi-campus collapse",
    ),
    "Bryant-Stratton-College-Amherst-Campus": (
        189583,
        "Amherst NY is a Buffalo suburb; nearest B&S unitid is Buffalo",
    ),
    "Bryant-Stratton-College-Eastlake-Campus": (
        201469,
        "only OH unitid is Parma; multi-campus collapse",
    ),
    "Bryant-Stratton-College-Henrietta-Campus": (
        189592,
        "Bryant & Stratton College-Greece, exact city (Rochester)",
    ),
    "Bryant-Stratton-College-Racine": (
        451750,
        "only WI unitid is Wauwatosa; multi-campus collapse",
    ),
    "Bryant-Stratton-College-Richmond-Campus": (
        231785,
        "only VA unitid is Virginia Beach; multi-campus collapse",
    ),
    "Calvin-University-Handlon-Campus": (
        169080,
        "Calvin University prison-education branch (appendix v)",
    ),
    "Central-Methodist-University": (
        176947,
        "Central Methodist University-College of Liberal Arts and Sciences, exact city (Fayette)",
    ),
    "Centro-de-Estudios-Multidisciplinarios-Humacao": (
        376224,
        "CEM College-Humacao, exact city; same brand (CEM = Centro de Estudios Multidiscipl.)",
    ),
    "Centro-de-Estudios-Multidisciplinarios-San-Juan": (
        241517,
        "CEM College-San Juan, exact city; same brand",
    ),
    "Centura-College-Chesapeake": (
        500290,
        "Arizona College of Nursing acquired/rebranded several Centura College campuses",
    ),
    "Chamberlain-College-of-Nursing-Irving": (
        466930,
        "Chamberlain University-Texas; multi-campus collapse (pre-rename name)",
    ),
    "Chamberlain-College-of-Nursing-Pearland": (
        466930,
        "Chamberlain University-Texas; multi-campus collapse (pre-rename name)",
    ),
    "Chamberlain-College-of-Nursing-Sacramento": (
        489353,
        "Chamberlain University-California, exact city (Rancho Cordova)",
    ),
    "Chamberlain-University-Addison": (454227, "Chamberlain University-Illinois, exact city"),
    "Chamberlain-University-Chicago": (454227, "only IL unitid is Addison; multi-campus collapse"),
    "Chamberlain-University-Cleveland": (
        454236,
        "Chamberlain University-Ohio; multi-campus collapse",
    ),
    "Chamberlain-University-Miramar": (
        457129,
        "Chamberlain University-Florida; multi-campus collapse",
    ),
    "Chamberlain-University-St-Louis": (466921, "Chamberlain University-Missouri, exact city"),
    "Chamberlain-University-Tinley-Park": (
        454227,
        "only IL unitid is Addison; multi-campus collapse",
    ),
    "Chamberlain-University-Tysons-Corner": (
        460871,
        "Chamberlain University-Virginia, exact city (Vienna)",
    ),
    "College-of-Technology-ECPI-College-of-Technology-Richmond-Innsbrook-West-End--VA": (
        248934,
        "ECPI's one national unitid; multi-campus collapse",
    ),
    "College-of-the-Marshall-Islands-Kwajalein-Campus": (
        376695,
        "College of the Marshall Islands, same institution",
    ),
    "Collin-Higher-Education-Center": (
        247834,
        "Collin County Community College District operates this facility",
    ),
    "Colorado-Mountain-College-Vail-Valley-at-Edwards": (
        126711,
        "Colorado Mountain College, satellite of the same CO district",
    ),
    "Columbia-College-Fort-Leonard-Wood": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-College-Fort-Sill": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-College-Fort-Stewart": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-College-Hunter-Army-Airfield": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-College-Missouri": (177065, "Columbia College, exact city (Columbia MO)"),
    "Columbia-College-Naval-Station-Everett-Marysville": (
        177065,
        "Columbia College (MO)'s known Naval Station Everett extension",
    ),
    "Columbia-College-Redstone-Arsenal": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-College-South-Carolina": (217934, "Columbia College, exact city (Columbia SC)"),
    "Columbia-College-Whidbey-Island": (
        177065,
        "Columbia College (MO)'s known Whidbey Island extension",
    ),
    "Columbia-College-Whiteman-AFB": (
        177065,
        "Columbia College (MO)'s well-known military-base extension network",
    ),
    "Columbia-University-School-of-General-Studies": (
        190150,
        "School of General Studies is a school within Columbia University, not separate",
    ),
    "Dallas-College-Brookhaven": (224615, "Dallas College's one unitid; multi-campus collapse"),
    "Dallas-College-Cedar-Valley": (224615, "Dallas College's one unitid; multi-campus collapse"),
    "Dallas-College-Eastfield": (224615, "Dallas College's one unitid; multi-campus collapse"),
    "Davenport-University-Wayne-CCCD": (169479, "Davenport University, satellite site"),
    "DeVry-University-Atlanta": (482468, "DeVry University-Georgia, exact city (Decatur)"),
    "DeVry-University-Chicago": (482477, "only IL unitid is Lisle; multi-campus collapse"),
    "DeVry-University-Chicago-Loop-Campus": (
        482477,
        "only IL unitid is Lisle; multi-campus collapse",
    ),
    "DeVry-University-Crystal-City": (482653, "DeVry University-Virginia, exact city (Arlington)"),
    "DeVry-University-Henderson-Campus": (
        482547,
        "DeVry University-Nevada, exact city (Henderson)",
    ),
    "DeVry-University-Irving": (482635, "DeVry University-Texas, exact city (Irving)"),
    "DeVry-University-Naperville": (482477, "DeVry University-Illinois, exact city (Lisle)"),
    "DeVry-University-Newark": (
        482431,
        "only CA unitid is Ontario; multi-campus collapse (Newark CA campus)",
    ),
    "DeVry-University-Online": (
        482477,
        "DeVry University-Illinois; the online arm reports from Lisle IL",
    ),
    "DeVry-University-Ontario": (482431, "DeVry University-California, exact city (Ontario)"),
    "DeVry-University-Sherman-Oaks-Campus": (
        482431,
        "only CA unitid is Ontario; multi-campus collapse",
    ),
    "Delaware-Technical-Community-College": (
        130907,
        "Delaware Technical Community College-Terry, exact city (Dover)",
    ),
    "Delaware-Technical-Community-College-Owens": (
        130907,
        "same institution's other campus; only one teaching-campus unitid available",
    ),
    "Denver-School-of-Nursing": (454856, "Denver College of Nursing, name variant"),
    "ECPI-University-Charlotte-NC": (248934, "ECPI's one national unitid; multi-campus collapse"),
    "ECPI-University-Columbia-SC": (248934, "ECPI's one national unitid; multi-campus collapse"),
    "ECPI-University-Greensboro-NC": (248934, "ECPI's one national unitid; multi-campus collapse"),
    "ECPI-University-Greenville-SC": (248934, "ECPI's one national unitid; multi-campus collapse"),
    "ECPI-University-North-Charleston-SC": (
        248934,
        "ECPI's one national unitid; multi-campus collapse",
    ),
    "ECPI-University-Orlando-Lake-Mary-FL": (
        248934,
        "ECPI's one national unitid; multi-campus collapse",
    ),
    "ECPI-University-Raleigh-NC": (248934, "ECPI's one national unitid; multi-campus collapse"),
    "ECPI-University-Roanoke": (248934, "ECPI University, sim=0.67; multi-campus collapse"),
    "East-Georgia-State-College-Statesboro": (139621, "East Georgia State College, sim=0.82"),
    "Evangel-University-James-River-Assembly-of-God-Church": (
        177339,
        "satellite site hosted at a church; same institution",
    ),
    "Everglades-University-Miami": (
        385619,
        "Everglades University, sim=0.78; multi-campus collapse",
    ),
    "Everglades-University-Orlando": (
        385619,
        "Everglades University, sim=0.72; multi-campus collapse",
    ),
    "Florida-National-University-South-Campus": (
        408844,
        "Florida National University-Main Campus, sim=0.76",
    ),
    "Florida-State-University-Panama-City": (
        134097,
        "Florida State University, well-known regional campus of the same institution",
    ),
    "Galen-College-of-Nursing-Austin-Campus": (
        497116,
        "Galen Health Institutes-Austin Campus, exact city (Round Rock)",
    ),
    "Galen-College-of-Nursing-Gainesville-Campus": (
        498085,
        "Galen Health Institutes-Gainesville, exact city",
    ),
    "Galen-College-of-Nursing-Miami-Campus": (
        496991,
        "Galen Health Institutes-Miami Campus, exact city (Pembroke Pines)",
    ),
    "Galen-College-of-Nursing-Nashville-Campus": (
        497125,
        "Galen Health Institutes-Nashville Campus, exact city",
    ),
    "Galen-College-of-Nursing-Sarasota-Campus": (
        498076,
        "Galen Health Institutes-Sarasota, exact city",
    ),
    "Georgia-Military-College-Augusta": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Columbus": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Dublin": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Fairburn": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Fayetteville": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Madison": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Robins": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Stone-Mountain": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Georgia-Military-College-Valdosta": (
        485111,
        "Georgia Military College's one unitid; multi-campus collapse",
    ),
    "Graceland-University-Independence": (
        153366,
        "Graceland University-Lamoni; well-documented 2-campus single institution",
    ),
    "HCI-College-Fort-Lauderdale-Campus": (
        495439,
        "Arizona College of Nursing-Fort Lauderdale (HCI rebrand), exact city",
    ),
    "HCI-College-West-Palm-Beach": (
        428170,
        "Southeastern College-West Palm Beach (HCI predecessor brand), exact city",
    ),
    "Humphreys-College-Modesto": (
        115773,
        "Humphreys University-Stockton and Modesto Campuses, name variant",
    ),
    "Inter-American-University-of-Puerto-Rico-Aguadilla-Campus": (
        242626,
        "sim=0.88, near-exact name/city",
    ),
    "Inter-American-University-of-Puerto-Rico-Arecibo-Campus": (
        242635,
        "sim=0.87, near-exact name/city",
    ),
    "Inter-American-University-of-Puerto-Rico-Bayamon-Campus": (
        242705,
        "sim=0.87, near-exact name/city",
    ),
    "Keiser-University-Clearwater": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Daytona-Beach-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Fort-Myers-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Jacksonville-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Lakeland-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Melbourne-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Miami-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-New-Port-Richey": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Orlando-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Pembroke-Pines-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Port-St-Lucie": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Sarasota-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Tallahassee-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-Tampa-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "Keiser-University-West-Palm-Beach-FL": (
        135081,
        "Keiser's one unitid (Ft Lauderdale flagship); multi-campus collapse",
    ),
    "MiraCosta-College-San-Elijo-Campus": (
        118912,
        "MiraCosta College, satellite of the same CA community college",
    ),
    "National-University-College-Bayamon": (242972, "NUC University, exact city (Bayamon)"),
    "Ohio-University-Eastern": (
        204802,
        "Ohio University-Eastern Campus, exact city (Saint Clairsville)",
    ),
    "Park-University-Gilbert": (178721, "Park University, satellite of the same MO institution"),
    "Penn-State-University-Park": (
        214777,
        "Pennsylvania State University-Main Campus, exact city -- not the World Campus brand",
    ),
    "Penn-State-Worthington-Scranton": (
        214652,
        "Pennsylvania State University-Penn State Scranton, Dunmore is adjacent to Scranton",
    ),
    "Penn-State-York": (214829, "Pennsylvania State University-Penn State York, exact city"),
    "PennWest-Edinboro": (
        498571,
        "Pennsylvania Western University, the 2022 PASSHE merger's IPEDS record",
    ),
    "Phillips-Beth-Israel-School-of-Nursing": (
        189282,
        "Mount Sinai Phillips School of Nursing (post-merger name), exact city",
    ),
    "Pierce-College-Fort-Steilacoom": (235237, "Pierce College District, exact city (Lakewood)"),
    "Purdue-University": (
        243780,
        "Purdue University-Main Campus, exact city -- not Purdue Global (the online brand)",
    ),
    "Purdue-University-Purdue-Polytechnic-Anderson": (
        None,
        "satellite instructional site; too uncertain which Purdue unitid to attribute to",
    ),
    "Purdue-University-Purdue-Polytechnic-Columbus": (
        None,
        "satellite instructional site; too uncertain which Purdue unitid to attribute to",
    ),
    "Purdue-University-Purdue-Polytechnic-Kokomo": (
        None,
        "satellite instructional site; too uncertain which Purdue unitid to attribute to",
    ),
    "Purdue-University-Purdue-Polytechnic-Lafayette": (
        None,
        "satellite instructional site; too uncertain which Purdue unitid to attribute to",
    ),
    "Purdue-University-Purdue-Polytechnic-New-Albany": (
        None,
        "satellite instructional site; too uncertain which Purdue unitid to attribute to",
    ),
    "Rasmussen-University-Bloomington": (
        175014,
        "Rasmussen University-Minnesota; multi-campus collapse",
    ),
    "Rasmussen-University-Brooklyn-Park": (
        175014,
        "Rasmussen University-Minnesota; multi-campus collapse",
    ),
    "Rasmussen-University-Central-Pasco": (
        138309,
        "Rasmussen University-Florida; multi-campus collapse",
    ),
    "Rasmussen-University-Eagan": (175014, "Rasmussen University-Minnesota; multi-campus collapse"),
    "Rasmussen-University-Fargo": (200013, "Rasmussen University-North Dakota, exact city"),
    "Rasmussen-University-Fort-Myers": (
        138309,
        "Rasmussen University-Florida; multi-campus collapse",
    ),
    "Rasmussen-University-Green-Bay": (
        450571,
        "Rasmussen University-Wisconsin; multi-campus collapse",
    ),
    "Rasmussen-University-Kansas-City-Overland-Park": (
        480657,
        "Rasmussen University-Kansas; multi-campus collapse",
    ),
    "Rasmussen-University-Mankato": (
        175014,
        "Rasmussen University-Minnesota; multi-campus collapse",
    ),
    "Rasmussen-University-Mokena-Tinley-Park": (None, "no Illinois Rasmussen unitid exists"),
    "Rasmussen-University-Moorhead": (
        175014,
        "Rasmussen University-Minnesota; multi-campus collapse",
    ),
    "Rasmussen-University-Ocala-School-of-Nursing": (
        138309,
        "Rasmussen University-Florida, exact city (Ocala)",
    ),
    "Rasmussen-University-Romeoville-Joliet": (None, "no Illinois Rasmussen unitid exists"),
    "Rasmussen-University-St-Cloud": (175014, "Rasmussen University-Minnesota, exact city"),
    "Rasmussen-University-Tampa-Brandon": (
        138309,
        "Rasmussen University-Florida; multi-campus collapse",
    ),
    "Rasmussen-University-Wausau": (
        450571,
        "Rasmussen University-Wisconsin; multi-campus collapse",
    ),
    "Saint-Josephs-University-School-of-Nursing-and-Allied-Health": (
        442356,
        "Saint Joseph's University - Lancaster, exact city",
    ),
    "San-Diego-State-University-Imperial-Valley-Campus": (
        122409,
        "San Diego State University; same institution, satellite collapse",
    ),
    "San-Jacinto-College-North-Campus": (
        227979,
        "San Jacinto Community College; multi-campus collapse",
    ),
    "San-Jacinto-College-South-Campus": (
        227979,
        "San Jacinto Community College; multi-campus collapse",
    ),
    "San-Jacinto-Community-College-District-Generation-Park-Campus": (
        227979,
        "San Jacinto Community College; multi-campus collapse",
    ),
    "Savannah-College-of-Art-and-Design-Atlanta": (
        140951,
        "Savannah College of Art and Design; well-known second campus, same institution",
    ),
    "South-College-Orlando": (
        220552,
        "South College (Knoxville TN flagship); multi-campus collapse",
    ),
    "St-Josephs-College-Brooklyn-Campus": (
        195544,
        "St. Joseph's University-New York, exact city (Brooklyn)",
    ),
    "St-Josephs-College-Long-Island-Campus": (
        195544,
        "St. Joseph's University-New York; only NY unitid, multi-campus collapse",
    ),
    "Strayer-University-Alexandria": (233684, "Strayer University-Virginia; multi-campus collapse"),
    "Strayer-University-Allentown": (
        443784,
        "Strayer University-Pennsylvania; multi-campus collapse",
    ),
    "Strayer-University-Anne-Arundel": (
        430184,
        "Strayer University-Maryland; multi-campus collapse",
    ),
    "Strayer-University-Arlington": (233684, "Strayer University-Virginia, exact city"),
    "Strayer-University-Baymeadows": (None, "no Florida Strayer unitid exists"),
    "Strayer-University-Birmingham": (None, "no Alabama Strayer unitid exists"),
    "Strayer-University-Cedar-Hill": (458973, "Strayer University-Texas; multi-campus collapse"),
    "Strayer-University-Center-City": (
        443784,
        "Strayer University-Pennsylvania; multi-campus collapse",
    ),
    "Strayer-University-Charleston-Campus-North-Charleston-SC": (
        None,
        "no South Carolina Strayer unitid exists",
    ),
    "Strayer-University-Chesterfield-Campus": (
        233684,
        "Strayer University-Virginia; multi-campus collapse",
    ),
    "Strayer-University-Columbia-Campus": (None, "no South Carolina Strayer unitid exists"),
    "Strayer-University-Columbus-Campus": (
        458919,
        "Strayer University-Georgia; multi-campus collapse",
    ),
    "Strayer-University-Delaware": (None, "no Delaware Strayer unitid exists"),
    "Strayer-University-Fredericksburg-Campus": (
        233684,
        "Strayer University-Virginia; multi-campus collapse",
    ),
    "Strayer-University-Huntsville-Campus": (None, "no Alabama Strayer unitid exists"),
    "Strayer-University-Knoxville-Campus": (
        443766,
        "Strayer University-Tennessee; multi-campus collapse",
    ),
    "Strayer-University-Lithonia-Campus": (
        458919,
        "Strayer University-Georgia; multi-campus collapse",
    ),
    "Strayer-University-Little-Rock-Campus": (None, "no Arkansas Strayer unitid exists"),
    "Strayer-University-Lower-Bucks-County-Campus": (
        443784,
        "Strayer University-Pennsylvania, exact city (Trevose)",
    ),
    "Strayer-University-Macon-Campus": (
        458919,
        "Strayer University-Georgia; multi-campus collapse",
    ),
    "Strayer-University-Miramar-Campus": (None, "no Florida Strayer unitid exists"),
    "Strayer-University-Montgomery-Campus": (None, "no Alabama Strayer unitid exists"),
    "Strayer-University-Morrow-Campus": (
        458919,
        "Strayer University-Georgia; multi-campus collapse",
    ),
    "Strayer-University-Nashville-Campus": (
        443766,
        "Strayer University-Tennessee; multi-campus collapse",
    ),
    "Strayer-University-North-Charlotte-Campus": (None, "no North Carolina Strayer unitid exists"),
    "Strayer-University-North-Dallas-Campus": (
        458973,
        "Strayer University-Texas, exact city (Farmers Branch)",
    ),
    "Strayer-University-North-Raleigh-Campus": (None, "no North Carolina Strayer unitid exists"),
    "Strayer-University-Orlando-East-Campus": (None, "no Florida Strayer unitid exists"),
    "Strayer-University-Piscataway-Campus": (None, "no New Jersey Strayer unitid exists"),
    "Strayer-University-Savannah-Campus": (
        458919,
        "Strayer University-Georgia; multi-campus collapse",
    ),
    "Strayer-University-Shelby-Campus": (
        443766,
        "Strayer University-Tennessee, exact city (Memphis)",
    ),
    "Strayer-University-South-Charlotte-Campus": (None, "no North Carolina Strayer unitid exists"),
    "Strayer-University-South-Raleigh-Campus": (None, "no North Carolina Strayer unitid exists"),
    "Strayer-University-Teays-Valley-Campus": (None, "no West Virginia Strayer unitid exists"),
    "Strayer-University-Virginia-Beach-Campus": (
        233684,
        "Strayer University-Virginia; multi-campus collapse",
    ),
    "Strayer-University-Washington-Campus": (
        131803,
        "Strayer University-District of Columbia, exact city",
    ),
    "Strayer-University-White-Marsh-Campus": (
        430184,
        "Strayer University-Maryland; multi-campus collapse",
    ),
    "Texas-A-M-University-Corps-of-Cadets": (
        228723,
        "Corps of Cadets is a student program within Texas A&M-College Station,"
        " not a separate campus",
    ),
    "Troy-University-Dothan": (102368, "Troy University's one unitid; multi-campus collapse"),
    "Troy-University-Montgomery": (102368, "Troy University's one unitid; multi-campus collapse"),
    "Tulane-School-of-Professional-Advancement": (
        160755,
        "School of Professional Advancement is a school within Tulane University, not separate",
    ),
    "University-of-Alaska-Southeast-Ketchikan-Campus": (
        102632,
        "University of Alaska Southeast; well-documented 3-campus single institution",
    ),
    "University-of-Arizona-South": (
        104179,
        "University of Arizona, sim=0.79 (appendix v's own worked example)",
    ),
    "University-of-the-Virgin-Islands-Albert-A-Sheen": (
        243665,
        "University of the Virgin Islands; well-documented 2-campus single institution",
    ),
    "Utah-State-University-Eastern": (
        230728,
        "Utah State University; well-known regional campus of the same institution",
    ),
    "Vermont-State-University-Williston": (
        231165,
        "Vermont State University (2023 PASSHE-style merger), extension site",
    ),
    "Washington-State-University-Everett": (
        236939,
        "Washington State University; all WSU branch campuses share the Pullman unitid",
    ),
    "Washington-State-University-Heath-Sciences-Spokane": (
        236939,
        "Washington State University; all WSU branch campuses share the Pullman unitid",
    ),
    "Washington-State-University-Tri-Cities": (
        236939,
        "Washington State University; all WSU branch campuses share the Pullman unitid",
    ),
    "Washington-State-University-Vancouver": (
        236939,
        "Washington State University; all WSU branch campuses share the Pullman unitid",
    ),
}
