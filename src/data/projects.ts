export interface Project {
  slug: string;
  title: string;
  no: number;
  start: number;
}

// Order = ribbon order = list order. Each case has case-<slug>.mp4 and case-<slug>-1440/-960.webp in public/media.
export const projects: Project[] = [
  { slug: "target-network", title: "target network", no: 14, start: 7.0 },
  { slug: "sd-wan", title: "sd-wan", no: 13, start: 6.0 },
  { slug: "slack-escalation", title: "slack escalation", no: 12, start: 8.5 },
  { slug: "cisco-edgecore", title: "cisco & edgecore", no: 11, start: 5.0 },
  { slug: "mist-meraki", title: "mist & meraki", no: 10, start: 4.0 },
  { slug: "aiu-centre-cctv", title: "aiu centre cctv", no: 9, start: 3.0 },
  { slug: "cctv-branches", title: "cctv branches", no: 8, start: 6.5 },
  { slug: "ticketing-rma", title: "ticketing & rma", no: 7, start: 5.5 },
  { slug: "cable-plans", title: "cable plans", no: 6, start: 7.5 },
  { slug: "itil-4", title: "itil 4", no: 5, start: 6.0 },
  { slug: "network-security", title: "network security", no: 4, start: 5.0 },
  { slug: "vibe-coding", title: "vibe coding", no: 3, start: 9.0 },
  { slug: "ai-automation", title: "ai automation", no: 2, start: 4.5 },
  { slug: "website-creation", title: "website creation", no: 1, start: 8.0 },
];

// Files live in /public/media and are served relative to the page, so any GitHub Pages path works.
export const assetUrl = (file: string) => `${import.meta.env.BASE_URL}media/${file}`;
// Poster size for card textures: the 960 set unless the centred card spans more than 960 device pixels.
export const POSTER_WIDTH = window.innerWidth * Math.min(window.devicePixelRatio, 1.75) * 0.5 > 960 ? 1440 : 960;
export const posterUrl = (p: Project, width: number = POSTER_WIDTH) => assetUrl(`case-${p.slug}-${width}.webp`);
export const videoUrl = (p: Project) => assetUrl(`case-${p.slug}.mp4`);
