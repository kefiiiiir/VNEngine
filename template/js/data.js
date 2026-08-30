/* ===========================================================
   VNengine - project data (the "assets manifest").

   This file is a TEMPLATE. Edit it to describe your own novel:
   which backgrounds exist, which characters exist and what
   expression sprites they have.

   Paths are written out explicitly (case matters on some hosts).
   A character with no matching image just renders as a labelled
   placeholder card - the engine never crashes on a missing file.
   =========================================================== */
(function (global) {
  'use strict';

  var BG = 'src/img/bg/';
  var CH = 'src/img/characters/';

  /* name -> image path.  '' (empty string) means "plain black screen".
     Use the name in a script with  bg('room')  /  bg('black'). */
  var BACKGROUNDS = {
    room:  BG + 'room.png',
    black: ''
  };

  /* id -> character.
       name    : shown in the name box
       color   : accent colour (name box tint + placeholder card)
       sprites : expression key -> image path
     Reference an expression from a script with  show('ari', 'talk')  or
     say('ari', '...', 'talk').  Missing key falls back to 'idle', then
     to a placeholder card. */
  var CHARACTERS = {
    ari: {
      name: 'Ari',
      color: '#8ecbff',
      sprites: {
        idle:   CH + 'Example/example_idle.png',
        talk:   CH + 'Example/example_talk.png',
        argue:  CH + 'Example/example_argue.png',
        bad:    CH + 'Example/example_badmood.png',
        scared: CH + 'Example/example_scared.png',
        point:  CH + 'Example/example_point.png'
      }
    },

    /* No sprites on purpose - shows the placeholder-card fallback.
       Delete this once you have real art. */
    mio: {
      name: 'Mio',
      color: '#ffd9a8',
      sprites: {}
    }
  };

  /* Optional: extra sound effects loaded from audio files (short mp3/ogg/wav).
     In a script,  sfx('name')  first looks for a synthesized sound in
     audio.js, then for a file registered here.  Empty by default. */
  var SFX_FILES = {
    // door: 'src/audio/sfx/door.mp3'
  };

  /* Suggested expression order for new characters - purely a convention. */
  var EXPRESSIONS = ['idle', 'talk', 'argue', 'bad', 'scared', 'point'];

  /* Images to warm up on load (built automatically from the two maps above). */
  var PRELOAD = [];
  Object.keys(BACKGROUNDS).forEach(function (k) {
    if (BACKGROUNDS[k]) PRELOAD.push(BACKGROUNDS[k]);
  });
  Object.keys(CHARACTERS).forEach(function (id) {
    var s = CHARACTERS[id].sprites || {};
    Object.keys(s).forEach(function (k) { if (s[k]) PRELOAD.push(s[k]); });
  });

  global.VNData = {
    BACKGROUNDS: BACKGROUNDS,
    CHARACTERS: CHARACTERS,
    SFX_FILES: SFX_FILES,
    EXPRESSIONS: EXPRESSIONS,
    PRELOAD: PRELOAD
  };
})(window);
