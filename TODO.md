# Task Checklist

## Step 1: Extract CSS from show.html into show.css
- [x] Create `show.css` with all inline `<style>` content from show.html

## Step 2: Extract JS from show.html into show.js  
- [x] Create `show.js` with all inline `<script>` content from show.html

## Step 3: Update show.html to link external files
- [x] Remove inline `<style>` block, link `show.css`
- [x] Remove inline `<script>` block, link `show.js`
- [x] Add hidden prev/next nav buttons

## Step 4: Add Keyboard Navigation to show.js
- [x] Add ArrowRight / Enter → advance next stage
- [x] Add ArrowLeft → go back to previous stage
- [x] Add hidden prev/next button triggers

## Step 5: Add 6-Match MVP Logic to show.js
- [x] Read ff_teams_data from localStorage for game count
- [x] If games multiple of 6: show MVP → Winner → Celebration → Points Table
- [x] If games < 6 or not multiple of 6: show only Winner Reveal + Points Table

## Step 6: Make show.html accept overlay/session params
- [x] Accept `?session=` query parameter like live.html
- [x] Load overlay data from localStorage for the session

## Step 7: Update overlay-buttons.js
- [x] Add "Launch Full Show" button to open show.html with overlay params
- [x] Updated b.html launch button to pass session param

