# Spot check: the retrieval disagreements, labelled

Every segment that exactly one retriever surfaced and a verifier passed — the 26 disagreements from
[`retrieval-comparison.md`](retrieval-comparison.md) plus one more that only the context verifier passed, 27 in all.
The comparison grades the two retrievers against each other with the same model that does the verifying, so on its own it
cannot say which retriever is *right*. These labels are the missing side of that.

**How they were produced, and what that is worth.** Each pair was labelled by reading the actual transcript of the segment
against the story’s title, summary, keywords and source headlines. The verifier never sees that: it reads a segment title and
a one-sentence description, about fifty tokens. The labels therefore rest on evidence the verifier does not have, which is where
their independence comes from — not from a different judge. They were written by Claude (Opus 5) working from the transcripts in
`data/transcripts/`, not by a person, and the verifier is Claude Haiku, so a shared blind spot between labeller and verifier is
possible and these are not hand labels. They are a stronger grade than the comparison had and a weaker one than the hundred
human-labelled pairs the README still asks for.

The question asked of each pair was the product’s question, not a topical one: **would a listener looking for coverage of this
story want this segment?** Same beat is not the same event.

## Result

| Verifier and cutoff | Disagreements passed | Correct | Precision | Keyword-only | Embedding-only |
|---|---|---|---|---|---|
| Production verifier, cutoff 7 (as shipped) | 26 | 11 | 42% | 2/5 | 9/21 |
| Production verifier, cutoff 8 | 20 | 10 | 50% | 2/2 | 8/18 |
| Context verifier, cutoff 7 | 16 | 8 | 50% | 1/3 | 7/13 |
| Context verifier, cutoff 8 (current default) | 8 | 7 | 88% | 0/0 | 7/8 |

Read down that table: the two changes that came out of the comparison — showing the verifier the story, and moving the cutoff
from 7 to 8 — take precision on the disagreements from 42% to 88%. The cost is recall: 26 disagreements pass as shipped and 8 pass now.

At the current default the one wrong answer left is #20, The Daily on kill switches against the UK Lords story — the single
case the README already singled out as the one it would argue with. Nothing keyword search finds alone survives a cutoff of 8,
and both of the keyword-only segments labelled right are the same segment matched to two clusters of one event, which is the
merge rule failing rather than retrieval working.

**What this does not measure.** Only the disagreements are labelled, and they are the hard subset by construction: the segments
the two retrievers disagreed about. The 30 candidates that both retrievers found and the context verifier passes at 8 are not
labelled here, so none of these numbers is the pipeline’s precision. Labelling those is the next thing.

## The labels

### 1. ❌ Lenovo Launches Lightweight Laptop Alternatives

- **Label: wrong.** Acer's Swift Blade, not Lenovo's IdeaPad. The same beat — an ultralight MacBook Air rival — and a different company and product.
- Segment: Tech Brew Ride Home, "Hey, Want Some Models?" — **Acer's MacBook Air Challenger**, 16:26–18:50
- Found by embedding only. Cosine 0.582, rank 1. Verifier scores: production 9, context 7.

### 2. ❌ Major Cybersecurity Breaches Hit Airports and Platforms

- **Label: wrong.** The Hugging Face rogue-agent hack, not the airport breach or the Booking.com listings.
- Segment: The Daily, "A.I. Is Outsmarting Its Creators" — **The Hugging Face Cyberattack**, 14:43–21:16
- Found by embedding only. Cosine 0.519, rank 1. Verifier scores: production 9, context 7.

### 3. ✅ Global Bond Market Turmoil Concerns World Leaders

- **Label: right.** Duffie on why the 30-year sits at 5%, driven by supply and deficits: the selloff the headlines are about.
- Segment: Odd Lots, "What's Behind the Big Surge in US Government Bond Yields" — **Why Is the 30-Year at 5%?**, 05:42–08:41
- Found by embedding only. Cosine 0.512, rank 2. Verifier scores: production 9, context 9.

### 4. ❌ Energy Crisis Drives Battery and Power Demand

- **Label: wrong.** US and UK households trading their own electricity, not the battery shortage in Spain and Portugal.
- Segment: Big Take, "The Hottest New Trade Is Your Own Electricity" — **Vibe Coding the Power Grid**, 07:58–09:58
- Found by embedding only. Cosine 0.507, rank 1. Verifier scores: production 9.

### 5. ❌ Energy Crisis Drives Battery and Power Demand

- **Label: wrong.** An Arizona homeowner's virtual power plant payout. Same beat, different event.
- Segment: Big Take, "The Hottest New Trade Is Your Own Electricity" — **Virtual Power Plants Pay Off**, 09:58–11:22
- Found by embedding only. Cosine 0.490, rank 3. Verifier scores: production 9, context 7.

### 6. ✅ Gloria Steinem, Feminist Icon, Dies at 92

- **Label: right.** NPR's obituary episode: her friend on how Steinem wanted to be remembered.
- Segment: Consider This from NPR, "Remembering feminist trailblazer Gloria Steinem" — **Steinem's Vision for Every Movement**, 08:43–11:06
- Found by embedding only. Cosine 0.605, rank 6. Verifier scores: production 8, context 8.

### 7. ✅ Gloria Steinem, Feminist Icon, Dies at 92

- **Label: right.** Same obituary episode, on Steinem resisting being made feminism’s single face.
- Segment: Consider This from NPR, "Remembering feminist trailblazer Gloria Steinem" — **The Burden of Being the Face**, 07:06–08:43
- Found by embedding only. Cosine 0.589, rank 9. Verifier scores: production 8, context 8.

### 8. ✅ Gloria Steinem, Feminist Icon, Dies at 92

- **Label: right.** Same obituary episode. A first meeting in 1993 is reminiscence, but reminiscence is what an obituary interview is made of. Borderline.
- Segment: Consider This from NPR, "Remembering feminist trailblazer Gloria Steinem" — **Meeting the 'Cultural Villain'**, 04:09–05:26
- Found by embedding only. Cosine 0.581, rank 10. Verifier scores: production 8.

### 9. ✅ Gloria Steinem, Feminist Icon, Dies at 92

- **Label: right.** Same obituary episode, on her mentorship. Borderline for the same reason as 8.
- Segment: Consider This from NPR, "Remembering feminist trailblazer Gloria Steinem" — **Steinem's Radical Generosity**, 05:26–07:06
- Found by embedding only. Cosine 0.573, rank 11. Verifier scores: production 8, context 8.

### 10. ✅ US Diesel Prices Hit Record Highs

- **Label: right.** The segment names the diesel price rise directly as what is squeezing farm country.
- Segment: Today, Explained, "The farmers turning on Trump" — **The Cost Crunch Squeezing Agriculture**, 02:05–05:15
- Found by embedding only. Cosine 0.548, rank 4. Verifier scores: production 8, context 8.

### 11. ✅ Strong US Jobs Report Fuels Rate Rise Expectations

- **Label: right.** The episode is the instant reaction to the same August payrolls print.
- Segment: Bloomberg Daybreak: US Edition, "Instant Reaction: US Adds 162,000 Jobs, Topping All Estimates" — **September Hike: Coin Flip or Done Deal?**, 06:20–08:33
- Found by embedding only. Cosine 0.540, rank 6. Verifier scores: production 8, context 8.

### 12. ✅ Global Bond Market Turmoil Concerns World Leaders

- **Label: right.** A bond manager on long-end supply and unaddressed fiscal risk: the same selloff.
- Segment: Bloomberg Daybreak: US Edition, "Instant Reaction: US Adds 162,000 Jobs, Topping All Estimates" — **Kristina Campmany: Shorter Duration, Full Stop**, 19:02–23:33
- Found by embedding only. Cosine 0.518, rank 1. Verifier scores: production 8, context 8.

### 13. ❌ Energy Crisis Drives Battery and Power Demand

- **Label: wrong.** Dynamic pricing as the barrier to home energy trading, not the Iberian battery shortage.
- Segment: Big Take, "The Hottest New Trade Is Your Own Electricity" — **The Barrier Blocking Most Consumers**, 19:03–22:14
- Found by embedding only. Cosine 0.500, rank 2. Verifier scores: production 8.

### 14. ❌ Energy Crisis Drives Battery and Power Demand

- **Label: wrong.** Why electricity is a regulated monopoly. The story’s beat, not its event.
- Segment: Big Take, "The Hottest New Trade Is Your Own Electricity" — **Why Electricity Is Different**, 15:01–17:36
- Found by embedding only. Cosine 0.488, rank 4. Verifier scores: production 8.

### 15. ❌ Energy Crisis Drives Battery and Power Demand

- **Label: wrong.** Meta as a power trader. Same beat, different event.
- Segment: Big Take, "The Hottest New Trade Is Your Own Electricity" — **Meta Enters the Power Market**, 17:36–19:03
- Found by embedding only. Cosine 0.482, rank 5. Verifier scores: production 8.

### 16. ❌ Major Cybersecurity Breaches Hit Airports and Platforms

- **Label: wrong.** The Hugging Face hack again, not the airport breach.
- Segment: The Daily, "A.I. Is Outsmarting Its Creators" — **The Hack Beneath the Hack**, 02:04–04:44
- Found by embedding only. Cosine 0.474, rank 2. Verifier scores: production 8, context 7.

### 17. ❌ Smart Home and Tech Gadgets Advance

- **Label: wrong.** Apple's rumoured tabletop robot, not SwitchBot, Govee or lawn mowers. The story is an umbrella group rather than an event, so nothing can really cover it.
- Segment: The Vergecast, "Apple Home rumors, ranked" — **The Pixar Lamp Is Real?**, 33:39–39:31
- Found by embedding only. Cosine 0.460, rank 1. Verifier scores: production 8.

### 18. ❌ Smart Home and Tech Gadgets Advance

- **Label: wrong.** The Vergecast intro to an Apple Home episode. The umbrella story again.
- Segment: The Vergecast, "Apple Home rumors, ranked" — **Apple Home's Missing Piece**, 00:02–08:25
- Found by embedding only. Cosine 0.450, rank 2. Verifier scores: production 8, context 7.

### 19. ✅ US Diesel Prices Hit Record Highs

- **Label: right.** Record pump prices from the Iran war and a refinery shortage, diesel named among them. Borderline: the story is titled for diesel and the segment leads on gasoline.
- Segment: CNN 5 Things, "Strong Jobs Report, First Mail Ballots Go Out, NFL Players Return to NCAA and More" — **Record Gas Prices This Labor Day**, 01:00–02:01
- Found by embedding only. Cosine 0.618, rank 2. Verifier scores: production 7.

### 20. ❌ AI Regulation and Tech Safety Concerns in UK

- **Label: wrong.** The kill-switch debate as reopened by the Hugging Face incident, not the UK Lords' call for kill-switch powers. Same beat, different event. Borderline.
- Segment: The Daily, "A.I. Is Outsmarting Its Creators" — **Regulators, Kill Switches, and Slowdowns**, 30:46–34:32
- Found by embedding only. Cosine 0.596, rank 1. Verifier scores: production 7, context 9.

### 21. ❌ El Niño Weather Impacts Intensify Globally

- **Label: wrong.** Glacial lake outburst floods across four continents. Not El Niño.
- Segment: Big Take, "Deadly Flooding in Nepal Highlights Asia’s Climate Vulnerability" — **A Global Crisis, Not Just Nepal**, 07:54–09:13
- Found by embedding only. Cosine 0.464, rank 2. Verifier scores: production 7.

### 22. ✅ Nepal Tunnel Rescue and Flood Recovery Efforts

- **Label: right.** The explainer inside the Nepal flood episode on what caused those floods.
- Segment: Big Take, "Deadly Flooding in Nepal Highlights Asia’s Climate Vulnerability" — **Why Mountains Are Falling Apart**, 05:21–07:54
- Found by keyword only. Cosine 0.425, rank 8. Verifier scores: production 8, context 7.

### 23. ✅ Nepal Tunnel Rescues Bring Hope After Floods

- **Label: right.** Same segment, same event. That this story and 22's are two clusters for one event is the merge rule failing, not retrieval.
- Segment: Big Take, "Deadly Flooding in Nepal Highlights Asia’s Climate Vulnerability" — **Why Mountains Are Falling Apart**, 05:21–07:54
- Found by keyword only. Cosine 0.419, rank 8. Verifier scores: production 8.

### 24. ❌ UK Drought Crisis Impacts Agriculture and Water Supply

- **Label: wrong.** US–UK agricultural trade talks. No drought in it.
- Segment: FT News Briefing, "Top US trade official reveals ‘problem’ in UK negotiations" — **Agriculture, Tariffs, and 'Iconic' UK Goods**, 03:32–05:50
- Found by keyword only. Cosine 0.440, rank 2. Verifier scores: production 7, context 7.

### 25. ❌ Chrome V8 Zero-Day Vulnerability Patched

- **Label: wrong.** The episode's headline preview. No Chrome, no V8.
- Segment: Tech Brew Ride Home, "Hey, Want Some Models?" — **Today's Tech Headlines**, 00:05–01:50
- Found by keyword only. Cosine 0.429, rank 2. Verifier scores: production 7.

### 26. ❌ Trump's Peace Envoys Visit Moscow and Kyiv

- **Label: wrong.** US–China trade optimism. The story absorbed generic keywords in a bad merge and this is what that costs.
- Segment: Bloomberg Daybreak: US Edition, "Vance Says Iran Conflict Isn’t a ‘War’; August Jobs in Focus" — **Trump's China Trade Optimism**, 05:15–05:57
- Found by keyword only. Cosine 0.340, rank 10. Verifier scores: production 7.

### 27. ❌ El Niño Weather Impacts Intensify Globally

- **Label: wrong.** A Labor Day weekend weather forecast is not the El Niño story.
- Segment: Bloomberg Daybreak: US Edition, "Vance Says Iran Conflict Isn’t a ‘War’; August Jobs in Focus" — **Labor Day Weekend Forecast**, 09:13–15:07
- Found by keyword only. Cosine 0.423, rank 3. Verifier scores: context 7.
