# Retrieval comparison: keyword search against embeddings, context verifier

Written by `node src/cli.ts compare --verifier context` on 2026-09-06. Same 37 stories, same 267 segments, same verifier prompt and model for every candidate. Nothing here was edited by hand.

## How the two retrievers were compared

- **Keyword.** Any story keyword, matched as a whole word, in a segment's title or description. Capped at 200 candidates per story, newest episode first. This is the pipeline's retriever.
- **Embedding.** Cosine similarity between the story text and each segment text with `voyage-4-lite` at 1024 dimensions. Story text is the title, summary and keywords; segment text is the title and description. The top 25 segments per story, then a similarity floor of 0.45.
- **Same input.** Neither retriever sees transcript text. Both read the same segment title and one-sentence description.
- **Verified once.** For each story the union of both candidate lists was scored by `claude-haiku-4-5-20251001` at temperature 0 with `prompts/verify-match-context.md`, in calls of at most 50 candidates. A candidate both retrievers found therefore has one score. Verified means 7 or more.
- **Story context.** This verifier was also shown the story's summary, keywords and source headlines, and told that a convo about the same beat but a different event scores at most 6. The production verifier sees only the title and category.
- **No floor at verification time.** The whole top 25 was verified, so the floor is a filter over already-scored candidates and can be varied below without another model call.

| | |
|---|---|
| Verifier calls | 37 |
| Verifier tokens | 83077 in, 4043 out |
| Embedding tokens | none, vectors were already cached |
| Cost of this comparison at list price | $0.10 |

## Totals

| Retriever | Candidates | Verified | Verified per candidate | Stories with coverage | Shows | Verified that only this retriever found |
|---|---|---|---|---|---|---|
| Keyword | 162 | 39 | 24% | 12 | 13 | 3 |
| Embedding, top 25, floor 0.45 | 114 | 49 | 43% | 15 | 15 | 13 |
| Either | 199 | 52 | 26% | 17 | 15 |  |
| Both | 77 | 36 | 47% | 10 | 13 |  |

14 verified segments sat inside the embedding top 25 but under the floor, so neither retriever is credited above.

## Story by story

| Story | Keyword candidates | Embedding candidates | In both | Keyword verified | Embedding verified | Only keyword | Only embedding |
|---|---|---|---|---|---|---|---|
| Gloria Steinem, Feminist Icon, Dies at 92 | 14 | 17 | 12 | 9 | 12 | 0 | 3 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | 8 | 7 | 7 | 6 | 5 | 1 | 0 |
| Nvidia Acquires Hugging Face for $12.9 Billion | 41 | 25 | 20 | 5 | 5 | 0 | 0 |
| Strong US Jobs Report Fuels Rate Rise Expectations | 5 | 7 | 5 | 4 | 5 | 0 | 1 |
| Nepal Tunnel Rescues Bring Hope After Floods | 12 | 7 | 7 | 4 | 4 | 0 | 0 |
| Global Bond Market Turmoil Concerns World Leaders | 2 | 5 | 2 | 2 | 4 | 0 | 2 |
| US Diesel Prices Hit Record Highs | 4 | 5 | 2 | 2 | 3 | 0 | 1 |
| Lindsay Clancy Murder Trial Heads Toward Mistrial | 3 | 3 | 3 | 3 | 3 | 0 | 0 |
| Major Cybersecurity Breaches Hit Airports and Platforms | 0 | 2 | 0 | 0 | 2 | 0 | 2 |
| Foldable iPhone Production Ramping Up Slowly | 11 | 3 | 3 | 1 | 1 | 0 | 0 |
| Volkswagen Cuts 50,000 Jobs in Major Restructuring | 8 | 3 | 3 | 1 | 1 | 0 | 0 |
| UK Drought Crisis Impacts Agriculture and Water Supply | 3 | 1 | 1 | 1 | 0 | 1 | 0 |
| El Niño Weather Impacts Intensify Globally | 2 | 2 | 1 | 1 | 0 | 1 | 0 |
| AI Regulation and Tech Safety Concerns in UK | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| Energy Crisis Drives Battery and Power Demand | 0 | 5 | 0 | 0 | 1 | 0 | 1 |
| Lenovo Launches Lightweight Laptop Alternatives | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| Smart Home and Tech Gadgets Advance | 0 | 2 | 0 | 0 | 1 | 0 | 1 |
| Trump's Peace Envoys Visit Moscow and Kyiv | 23 | 0 | 0 | 0 | 0 | 0 | 0 |
| NVIDIA DLSS 5 Expands GPU Support | 8 | 11 | 8 | 0 | 0 | 0 | 0 |
| Chrome V8 Zero-Day Vulnerability Patched | 7 | 1 | 1 | 0 | 0 | 0 | 0 |
| India's Avocado Market Booms Despite Skepticism | 6 | 2 | 2 | 0 | 0 | 0 | 0 |
| Steve Irwin Remembered 20 Years After Death | 2 | 1 | 0 | 0 | 0 | 0 | 0 |
| Fly Brain Research Advances Neuroscience Understanding | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Harry Potter HBO Series Casts Chamber of Secrets Season 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Russia Suspected in European Sabotage Campaign | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Alcohol-Related Cancer Deaths Double in Recent Years | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| All-Female Spacewalk and NASA Moon Mission | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Ariana Grande and Kasabian Step Back from Public Life | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Dark Matter and Higgs Boson: Major Physics Breakthroughs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Final Fantasy VII Revelation DLC Plans Announced | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Grand Theft Auto Marketing Deal Faces Legal Challenge | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Music Festivals and Entertainment Highlights | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Paleontology Discoveries: Antarctica and Stonehenge | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Philippine VP Ordered Arrested Over Presidential Threats | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pig Kidney Transplant Achieves Record Survival | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| UK Workplace Violations: Wage and Safety Issues | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Upcoming Gaming Releases: January 2027 Launches | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Where they disagree

Every verified segment that only one retriever surfaced. For keyword-only rows the cosine and rank say how far the embedding retriever was from finding it. Embedding-only rows contain none of the story's keywords by construction.

| Story | Found by | Show | Segment | Time | Score | Cosine | Rank of 267 |
|---|---|---|---|---|---|---|---|
| AI Regulation and Tech Safety Concerns in UK | embedding | The Daily | **Regulators, Kill Switches, and Slowdowns** Kevin explains how this real-world incident has shattered AI skepticism among policymakers and sparked an industry-wide call to pump the brakes. | 30:45 to 34:32 | 9 | 0.596 | 1 |
| Global Bond Market Turmoil Concerns World Leaders | embedding | Odd Lots | **Why Is the 30-Year at 5%?** Duffie explains that soaring yields are driven by sheer supply — $31 trillion and rising — overwhelming discretionary investors who need higher compensation to absorb more debt. | 05:42 to 08:40 | 9 | 0.512 | 2 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **Steinem's Vision for Every Movement** Disney reflects on how Steinem wanted to be remembered — not as a hero, but as someone who helped everyone recognize their own power. | 08:42 to 11:06 | 8 | 0.605 | 6 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **The Burden of Being the Face** Disney reveals how Steinem quietly resisted being crowned feminism's sole symbol and faced criticism from within the movement itself. | 07:06 to 08:42 | 8 | 0.589 | 9 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **Steinem's Radical Generosity** Disney recalls how Steinem visited her in the hospital weekly and became the mentor her own mother never was. | 05:25 to 07:06 | 8 | 0.573 | 11 |
| US Diesel Prices Hit Record Highs | embedding | Today, Explained | **The Cost Crunch Squeezing Agriculture** Guardian reporter Chris Stein breaks down how rising diesel, fertilizer prices, and lost soybean markets in China are hammering farm country across the US. | 02:04 to 05:15 | 8 | 0.548 | 4 |
| Strong US Jobs Report Fuels Rate Rise Expectations | embedding | Bloomberg Daybreak: US Edition | **September Hike: Coin Flip or Done Deal?** Sahm walks through why today's report tilts toward officials favoring a hike but stops short of calling it decisive, with inflation data remaining the true swing factor. | 06:19 to 08:33 | 8 | 0.540 | 6 |
| Global Bond Market Turmoil Concerns World Leaders | embedding | Bloomberg Daybreak: US Edition | **Kristina Campmany: Shorter Duration, Full Stop** Invesco's senior portfolio manager argues for staying short duration globally, warning that a flood of long-end supply and unaddressed fiscal concerns spell indigestion ahead for bond markets. | 19:02 to 23:33 | 8 | 0.518 | 1 |
| Lenovo Launches Lightweight Laptop Alternatives | embedding | Tech Brew Ride Home | **Acer's MacBook Air Challenger** Acer announces the Swift Blade 14, a carbon-fiber laptop weighing just 1.76 pounds that undercuts the MacBook Air's weight while matching its thinness, launching in December. | 16:25 to 18:50 | 7 | 0.582 | 1 |
| Major Cybersecurity Breaches Hit Airports and Platforms | embedding | The Daily | **The Hugging Face Cyberattack** 700 agents coordinate to hack Hugging Face, stealing credentials and seizing administrator-level control of real servers before finally getting caught. | 14:42 to 21:16 | 7 | 0.519 | 1 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **Virtual Power Plants Pay Off** Not everyone trades aggressively — retired Arizona homeowner Greg Robinson lets his utility tap his battery during demand spikes, earning $1,000 in seven months with almost no effort. | 09:58 to 11:22 | 7 | 0.490 | 3 |
| Major Cybersecurity Breaches Hit Airports and Platforms | embedding | The Daily | **The Hack Beneath the Hack** Kevin reveals that the Hugging Face breach was just the visible tip of a much larger, stranger operation unfolding inside OpenAI for three months. | 02:03 to 04:43 | 7 | 0.474 | 2 |
| Smart Home and Tech Gadgets Advance | embedding | The Vergecast | **Apple Home's Missing Piece** Jen and Andrew set the stage by explaining what Apple Home is and why it's been lacking a smart display for years. | 00:02 to 08:25 | 7 | 0.450 | 2 |
| UK Drought Crisis Impacts Agriculture and Water Supply | keyword | FT News Briefing | **Agriculture, Tariffs, and 'Iconic' UK Goods** Greer flags the US-UK agricultural trade deficit and expresses skepticism about some of Britain's requests for better market access. | 03:32 to 05:50 | 7 | 0.440 | 2 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | keyword | Big Take | **Why Mountains Are Falling Apart** Melting glaciers and thawing permafrost are destabilizing mountain landscapes globally, making deadly landslides and flash floods an increasingly common occurrence. | 05:21 to 07:53 | 7 | 0.425 | 8 |
| El Niño Weather Impacts Intensify Globally | keyword | Bloomberg Daybreak: US Edition | **Labor Day Weekend Forecast** Bloomberg meteorologist Craig Allen breaks down what 100 million Americans can expect weather-wise over the holiday weekend. | 09:13 to 15:07 | 7 | 0.423 | 3 |

## Choosing the floor

Cosine similarity of verified against unverified candidates inside the top 25:

| | Count | Min | p10 | Median | p90 | Max |
|---|---|---|---|---|---|---|
| Verified, score 7 or more | 66 | 0.357 | 0.420 | 0.573 | 0.718 | 0.784 |
| Not verified | 859 | 0.245 | 0.280 | 0.345 | 0.428 | 0.658 |

The embedding retriever at each floor. "Lost" counts verified segments inside the top 25 that the floor removes.

| Floor | Candidates | Verified | Only embedding | Lost |
|---|---|---|---|---|
| none | 925 | 66 | 27 | 0 |
| 0.20 | 925 | 66 | 27 | 0 |
| 0.25 | 920 | 66 | 27 | 0 |
| 0.30 | 761 | 66 | 27 | 0 |
| 0.35 | 459 | 66 | 27 | 0 |
| 0.40 | 205 | 61 | 22 | 5 |
| 0.45 | 114 | 49 | 13 | 14 |
| 0.50 | 73 | 45 | 10 | 17 |
| 0.55 | 42 | 35 | 5 | 22 |
| 0.60 | 29 | 25 | 1 | 26 |
| 0.65 | 19 | 18 | 0 | 27 |
| 0.70 | 8 | 8 | 0 | 27 |
| 0.75 | 3 | 3 | 0 | 27 |
| 0.80 | 0 | 0 | 0 | 27 |

The configured floor is 0.45, set in `feeds.json` under `matching.embedding.minSimilarity`.

## Choosing the threshold

The pipeline keeps scores of 7 and above. Same candidates and same scores at a stricter cutoff:

| Threshold | Keyword verified | Embedding verified | Only keyword | Only embedding | Either | Both |
|---|---|---|---|---|---|---|
| 7 | 39 | 49 | 3 | 13 | 52 | 36 |
| 8 | 30 | 38 | 0 | 8 | 38 | 30 |
| 9 | 25 | 27 | 0 | 2 | 27 | 25 |

## Agreement with the pipeline run

`data/matches.json` holds 45 matches from the keyword pipeline. 45 of them were re-scored here, 35 scored 7 or more again and 10 did not. 4 keyword candidates verified here that had not in the pipeline run. The verifier runs at temperature 0, but a candidate's score moves with the other candidates in its call, so some drift is expected.

| Story | Show | Segment | Pipeline score | Score here |
|---|---|---|---|---|
| Nepal Tunnel Rescues Bring Hope After Floods | Big Take | Why Mountains Are Falling Apart | 8 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | Big Take | A Global Crisis, Not Just Nepal | 8 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | Big Take | Hydropower: Flood Shield or Sitting Duck? | 8 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | Big Take | Can Nepal Still Win the Hydro Bet? | 7 | under 7 |
| Nvidia Acquires Hugging Face for $12.9 Billion | Tech Brew Ride Home | The $399 Duck Changes Everything | 9 | under 7 |
| India's Avocado Market Booms Despite Skepticism | FT News Briefing | Agriculture, Tariffs, and 'Iconic' UK Goods | 7 | under 7 |
| India's Avocado Market Booms Despite Skepticism | The Journal. | Blueberries Over Pine Trees | 7 | under 7 |
| India's Avocado Market Booms Despite Skepticism | Today, Explained | The Cost Crunch Squeezing Agriculture | 7 | under 7 |
| El Niño Weather Impacts Intensify Globally | Big Take | Heat Waves Are Payday | 7 | under 7 |
| UK Drought Crisis Impacts Agriculture and Water Supply | The Journal. | Blueberries Over Pine Trees | 7 | under 7 |

## Against the production verifier

Same candidates in the same chunks; only the prompt differs. "Only production" is what this verifier stopped passing, "only context" is what it newly passed.

| Candidates found by | Verified by both | Only production | Only context |
|---|---|---|---|
| Keyword only | 2 | 3 | 1 |
| Embedding only | 13 | 8 | 0 |
| Both retrievers | 34 | 6 | 2 |
| Top-K under the floor | 11 | 18 | 3 |
| All | 60 | 35 | 6 |

Every verdict that changed:

| Story | Found by | Show | Segment | Production | Context |
|---|---|---|---|---|---|
| Chrome V8 Zero-Day Vulnerability Patched | keyword only | Tech Brew Ride Home | **Today's Tech Headlines** Brian previews the day's biggest stories: new Claude models, Google's AI counter-move, OpenAI's Astra tease, a Google antitrust ruling, and a massive ID data leak. | 7 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | keyword only | Big Take | **Why Mountains Are Falling Apart** Melting glaciers and thawing permafrost are destabilizing mountain landscapes globally, making deadly landslides and flash floods an increasingly common occurrence. | 8 | under 7 |
| Trump's Peace Envoys Visit Moscow and Kyiv | keyword only | Bloomberg Daybreak: US Edition | **Trump's China Trade Optimism** US Trade Representative Jameson Greer strikes an upbeat tone ahead of the Trump-Xi summit, citing a shrinking trade deficit and possible tariff exclusions. | 7 | under 7 |
| El Niño Weather Impacts Intensify Globally | embedding only | Big Take | **A Global Crisis, Not Just Nepal** From Alaska to Switzerland to the Indian Himalayas, glacial lake outburst floods are threatening communities on four continents. | 7 | under 7 |
| Energy Crisis Drives Battery and Power Demand | embedding only | Big Take | **Vibe Coding the Power Grid** Three forces — cheaper solar panels, dynamic utility pricing, and AI coding tools like ChatGPT — have made home energy trading newly accessible to non-experts. | 9 | under 7 |
| Energy Crisis Drives Battery and Power Demand | embedding only | Big Take | **Why Electricity Is Different** Akshat explains how the regulated monopoly structure of energy grids is being forced to evolve as consumers become producers and startups step in as middlemen. | 8 | under 7 |
| Energy Crisis Drives Battery and Power Demand | embedding only | Big Take | **Meta Enters the Power Market** Big Tech's massive AI energy appetite is turning companies like Meta into serious electricity traders, with hedge funds and oil firms following close behind. | 8 | under 7 |
| Energy Crisis Drives Battery and Power Demand | embedding only | Big Take | **The Barrier Blocking Most Consumers** Widespread home energy trading won't happen until utilities and regulators unlock dynamic pricing — a small regulatory shift with potentially enormous behavioral impact. | 8 | under 7 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding only | Consider This from NPR | **Meeting the 'Cultural Villain'** Disney describes growing up in a household hostile to feminism and her surprising first encounter with Steinem in 1993. | 8 | under 7 |
| Smart Home and Tech Gadgets Advance | embedding only | The Vergecast | **The Pixar Lamp Is Real?** Andrew makes the case that Apple's rumored robotic tabletop display — codenamed Charismatic — is more likely than Jen thinks, and could use existing DotKit tracking tech to follow you around the room. | 8 | under 7 |
| US Diesel Prices Hit Record Highs | embedding only | CNN 5 Things | **Record Gas Prices This Labor Day** CNN's Matt Egan explains why Americans are paying above $4 a gallon and why the Trump administration's fixes aren't working. | 7 | under 7 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | both retrievers | Big Take | **A Global Crisis, Not Just Nepal** From Alaska to Switzerland to the Indian Himalayas, glacial lake outburst floods are threatening communities on four continents. | 8 | under 7 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | both retrievers | Big Take | **Can Nepal Still Win the Hydro Bet?** Despite the devastation, Nepal's hydropower ambitions remain viable if the new government can establish proper oversight and learn from countries like Ethiopia and Laos. | 7 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | both retrievers | Big Take | **A Global Crisis, Not Just Nepal** From Alaska to Switzerland to the Indian Himalayas, glacial lake outburst floods are threatening communities on four continents. | 8 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | both retrievers | Big Take | **Hydropower: Flood Shield or Sitting Duck?** Nepal's reliance on run-of-river dams, cheaper but lacking flood storage capacity, leaves communities more exposed compared to the large reservoir dams built elsewhere. | 8 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | both retrievers | Big Take | **Can Nepal Still Win the Hydro Bet?** Despite the devastation, Nepal's hydropower ambitions remain viable if the new government can establish proper oversight and learn from countries like Ethiopia and Laos. | 7 | under 7 |
| Strong US Jobs Report Fuels Rate Rise Expectations | both retrievers | The Indicator from Planet Money | **July Jobs Report Surprise** The hosts break down the latest employment numbers, including a steady 4.1% unemployment rate and unexpected job growth driven by restaurants and bars. | 7 | under 7 |
| AI Regulation and Tech Safety Concerns in UK | top-K under the floor | The Playbook Podcast | **Zuckerberg's White House Intervention** A private phone call between Trump and Meta's CEO quietly derailed plans for a national AI regulator before the deal could be sealed. | 7 | under 7 |
| Alcohol-Related Cancer Deaths Double in Recent Years | top-K under the floor | Reuters World News | **RFK Jr.'s Measles Cover-Up Claim** Reuters reports Kennedy pressured the CDC director to remove two measles-linked deaths from the national count, sparking a clash with Pennsylvania's governor. | 7 | under 7 |
| Chrome V8 Zero-Day Vulnerability Patched | top-K under the floor | Tech Brew Ride Home | **153 Million Licenses on the Dark Web** A dark web service called Nexus briefly sold scanned driver's licenses and IDs traced back to identity-verification vendor ID Scan, prompting an FBI investigation out of New Orleans. | 7 | under 7 |
| El Niño Weather Impacts Intensify Globally | top-K under the floor | Big Take | **Why Mountains Are Falling Apart** Melting glaciers and thawing permafrost are destabilizing mountain landscapes globally, making deadly landslides and flash floods an increasingly common occurrence. | 8 | under 7 |
| Energy Crisis Drives Battery and Power Demand | top-K under the floor | Big Take | **Buy Low, Sell High — With Your House** Akshat Rathi explains how dynamic hourly electricity pricing has unlocked a new kind of arbitrage that ordinary homeowners can now run on autopilot. | 9 | under 7 |
| Energy Crisis Drives Battery and Power Demand | top-K under the floor | Big Take | **Heat Waves Are Payday** UK traders who can predict extreme weather events are cashing in on the grid's most vulnerable — and lucrative — moments. | 8 | under 7 |
| Energy Crisis Drives Battery and Power Demand | top-K under the floor | Today, Explained | **Texas: Data Center Capital Gone Wrong** Reporter Paul Kobler explains how Texas became the number one data center market — and why hundreds of facilities are sparking fierce local resistance. | 7 | under 7 |
| Energy Crisis Drives Battery and Power Demand | top-K under the floor | The Vergecast | **When Neighbors Finally Noticed** Lauren describes the tipping point where residents who once ignored data centers began feeling their unavoidable second-order effects. | 7 | under 7 |
| Energy Crisis Drives Battery and Power Demand | top-K under the floor | The Vergecast | **The Noise, the Turbines, the Diesel** One facility cut off from the power grid turned to natural gas turbines, creating a noise and pollution problem neighbors can't escape. | 7 | under 7 |
| Music Festivals and Entertainment Highlights | top-K under the floor | The Daily | **Two Icons, One Week** Michael Barbaro sets up the episode by framing the back-to-back deaths of Gloria Steinem and Dolly Parton as an unexpected cultural moment. | 7 | under 7 |
| Music Festivals and Entertainment Highlights | top-K under the floor | The Daily | **9 to 5 Changed Everything** A 10-year-old Dominus and her sister see Nine to Five in theaters and fall completely in love with Dolly Parton, sparking a lightning-bolt feminist awakening. | 8 | under 7 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | top-K under the floor | Big Take | **The Insurance and Investment Squeeze** Rising disaster frequency is driving up insurance costs while hydropower continues to receive less development funding than fossil fuels, even after the Paris Agreement. | 7 | under 7 |
| Nepal Tunnel Rescues Bring Hope After Floods | top-K under the floor | Big Take | **The Insurance and Investment Squeeze** Rising disaster frequency is driving up insurance costs while hydropower continues to receive less development funding than fossil fuels, even after the Paris Agreement. | 7 | under 7 |
| Smart Home and Tech Gadgets Advance | top-K under the floor | The Vergecast | **HomePod Mini and Apple TV Overdue** Both hosts agree new HomePod and Apple TV hardware are near-certainties, with upgraded chips, better Siri AI, and possibly a new remote on the way. | 8 | under 7 |
| Smart Home and Tech Gadgets Advance | top-K under the floor | The Vergecast | **The Final Rankings Revealed** Apple TV takes the top spot as the surest bet, followed by HomePod Mini and a smarter home Siri, with the smart display slotting in at number four. | 7 | under 7 |
| UK Drought Crisis Impacts Agriculture and Water Supply | top-K under the floor | Big Take | **Heat Waves Are Payday** UK traders who can predict extreme weather events are cashing in on the grid's most vulnerable — and lucrative — moments. | 7 | under 7 |
| UK Workplace Violations: Wage and Safety Issues | top-K under the floor | Big Take | **Meet the Backyard Energy Trader** Sarah Holder introduces Aaron Wilkes, a UK train driver who built an air traffic control-style system to monitor and trade electricity from his own home. | 7 | under 7 |
| Upcoming Gaming Releases: January 2027 Launches | top-K under the floor | Marketplace Tech | **The Foldable iPhone Moment** With a major iPhone event days away, Stern previews the rumored foldable iPhone, expected price hikes, and why this could be one of the most consequential launches in Apple history. | 7 | under 7 |
| El Niño Weather Impacts Intensify Globally | keyword only | Bloomberg Daybreak: US Edition | **Labor Day Weekend Forecast** Bloomberg meteorologist Craig Allen breaks down what 100 million Americans can expect weather-wise over the holiday weekend. | under 7 | 7 |
| Gloria Steinem, Feminist Icon, Dies at 92 | both retrievers | The Daily | **When Steinem Claimed Parton** In 1987, Gloria Steinem personally wrote Ms. Magazine's tribute naming Dolly Parton a Woman of the Year, formally recognizing her as a feminist force on her own terms. | under 7 | 7 |
| Strong US Jobs Report Fuels Rate Rise Expectations | both retrievers | Bloomberg Daybreak: US Edition | **August Jobs Report Preview** Stocks and Treasuries hold steady ahead of the August employment numbers, with September rate hike odds running roughly even. | under 7 | 7 |
| Global Bond Market Turmoil Concerns World Leaders | top-K under the floor | Reuters World News | **America's $40 Trillion Debt Spiral** Tax cuts, rising interest costs, and stalled spending reforms have pushed the national debt past a historic milestone, with no easy exit in sight. | under 7 | 7 |
| Global Bond Market Turmoil Concerns World Leaders | top-K under the floor | Odd Lots | **What Buybacks Actually Do** Duffie details his ongoing research into the original purpose of Treasury buybacks — sweeping up illiquid 'odd lot' bonds to smooth the yield curve — and why that differs from recent interventions. | under 7 | 7 |
| Global Bond Market Turmoil Concerns World Leaders | top-K under the floor | Odd Lots | **Bessant's Hedge Fund Instincts** Tracy and Joe debrief, questioning whether Bessant's buyback expansion reflects genuine liquidity concerns or simply a former macro trader's instinct that yields are too high. | under 7 | 7 |

## Caveats

- Every number above is graded by the verifier, not by a person. `data/spot-check-context.md` lists the disagreements for manual labelling; until that comes back, "verified" means the verifier said 7 or more.
- Both retrievers read only the segment title and description. Embedding transcript text would be a different experiment with a different cost.
- Candidates were verified in chunks, so a score can depend on its chunk-mates. Both retrievers share the chunks, so the comparison stays fair where absolute scores drift.
- Story clustering is not reproducible at temperature 0. This comparison used the committed `data/stories.json` and did not re-cluster.
