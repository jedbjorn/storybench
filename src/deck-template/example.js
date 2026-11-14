import { readFileSync } from 'node:fs';

// Synthetic input; no persistent state. A builder may supply its own local media bytes.
export const exampleDeck = {
  title: 'From idea to impact',
  slides: [
    { id: 'welcome', layout: 'title', eyebrow: 'A shared direction', title: 'Make room for better ideas', body: 'A practical plan for a small team.', notes: 'Welcome everyone. Invite one question.', targetMinutes: 1 },
    { id: 'chapter', layout: 'section', title: 'Start with the question', body: 'What would make the next week easier?', targetMinutes: 1 },
    { id: 'focus', layout: 'statement', title: 'Clarity creates momentum.', body: 'Choose one useful outcome before choosing the tools.', notes: 'Pause here.', targetMinutes: 1 },
    { id: 'options', layout: 'columns', title: 'Two ways forward', columns: [{ title: 'Explore', body: 'Try a small experiment. Learn from the result.' }, { title: 'Refine', body: 'Improve the working approach. Keep the useful parts.' }], targetMinutes: 2 },
    { id: 'steps', layout: 'process', title: 'A repeatable rhythm', body: 'Small steps, visible progress.', stages: [{ title: 'Observe', body: 'Name the obstacle.' }, { title: 'Try', body: 'Test one change.', afterMs: 1800 }, { title: 'Learn', body: 'Share what happened.', afterMs: 1800 }], subnav: ['Discover', 'Experiment', 'Reflect'], notes: 'Use left and right to take control of the reveals.', targetMinutes: 2 },
    { id: 'detail', layout: 'text-media', title: 'See the whole picture', body: 'A simple visual gives the group a common starting point.', media: { type: 'image', src: 'assets/example.png', alt: 'A small geometric color study' }, targetMinutes: 1 },
    { id: 'demo', layout: 'full-media', title: 'One idea in focus', media: { type: 'image', src: 'assets/example.png', alt: 'A small geometric color study' }, notes: 'Discuss what to try next.', targetMinutes: 1 },
  ],
};
export const exampleAssets = { 'assets/example.png': readFileSync(new URL('example-assets/example.png', import.meta.url)) };
