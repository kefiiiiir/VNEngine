# src/ - your assets

Drop your images and audio here, then point `js/data.js` (images) and
`js/audio.js` (`MUSIC` map) / `js/data.js` `SFX_FILES` (sounds) at them.

```
src/
  img/
    bg/                 backgrounds - any size, "cover"-fitted
      room.png          (example)
    characters/
      Example/          one folder per character (name is up to you)
        example_idle.png
        example_talk.png
        ...
  audio/
    music/
      theme.mp3         looping tracks
    sfx/                optional one-shot sound files
```

Nothing here is required. A missing background shows as black; a
character with no sprite shows as a labelled placeholder card; a
missing music/sfx file just stays silent. See `../VNengine.md`.
