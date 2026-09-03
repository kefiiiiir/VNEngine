/* ===========================================================
   VNengine - Chapter 2 (your novel, split into chapter files).

   Same pattern as js/story/chapter1.js: op builders come from
   js/story/story-helpers.js, and this file's ops get appended onto
   the ones chapter1.js already added. See chapter1.js's header
   comment and js/story/README.md for the full explanation.
   =========================================================== */
(function (global) {
  'use strict';

  var ops = [

    // chapter1.js's chapterEnd points its `next` here.
    label('chapter2_start'),
    music('theme', { volume: 0.5, fade: 2 }),

    bg('room'),
    show('ari', 'idle', 'center'),
    narr('A new day. This scene lives entirely in js/story/chapter2.js.'),
    say('ari', 'Back already, {first}? Good.', 'talk'),
    say('ari', "That's the whole point of chapters - one file per part of the story, instead of one huge one.", 'idle'),

    saveOp('Demo - end of chapter 2'),
    chapterEnd('Chapter 2 - Demo', null)   // next: null  ->  returns to the title screen
  ];

  global.VNScript = global.VNScript || { ops: [] };
  global.VNScript.ops = global.VNScript.ops.concat(ops);
})(window);
