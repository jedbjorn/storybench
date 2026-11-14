// Synthetic content in the exact schema edited by the app and agent tools.
export function demoSlides(imageId, videoId) {
  const slide = (id,layout,title,body,extra={}) => ({id,layout,title,body,eyebrow:'Field notes / 2030',targetMinutes:1,notes:`Explain “${title}” in your own words, then pause for questions.`,...extra});
  return [
    slide('opening','title','A clearer path to shared ideas','A small team turns scattered observations into one useful experiment.'),
    slide('problem','statement','The signal is already here','The challenge is giving people enough space to see it.',{notes:'Ask the audience where useful observations disappear in their own work.'}),
    slide('chapter','section','From observation to action','Three habits, one repeatable loop.'),
    slide('explain','text-media','Make the work visible','A simple visual gives the conversation somewhere to begin.',{media:{itemId:imageId,alt:'Synthetic geometric landscape'},caption:'Original synthetic illustration; no private source assets.'}),
    slide('compare','columns','Choose the smallest useful experiment','Compare habits rather than people.',{columns:[{title:'Before',body:'Scattered notes\nUnspoken assumptions\nA large uncertain launch'},{title:'After',body:'One shared picture\nA question we can test\nA small reversible trial'}]}),
    slide('process','process','A loop that learns','Move from curiosity to evidence.',{stages:[{id:'notice',title:'Notice',body:'Collect an observation.'},{id:'frame',title:'Frame',body:'Name the question.',afterMs:1800},{id:'try',title:'Try',body:'Run a small experiment.',afterMs:1800},{id:'learn',title:'Learn',body:'Keep the useful signal.'}]}),
    slide('demo','full-media','See the experiment in motion','Use the views to compare a still with a short motion study.',{media:{itemId:videoId,alt:'Synthetic moving color study'},subnav:[{id:'still',label:'Still study',itemId:imageId},{id:'motion',label:'Motion study',itemId:videoId}],notes:'Play the short local video. Select each gallery view. Ask which representation communicates the idea more clearly.'}),
    slide('close','statement','One question. One experiment.','What could your team learn this week?',{notes:'Invite each participant to name one small experiment. End with a concrete next action.'}),
  ];
}
