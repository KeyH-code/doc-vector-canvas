const paths = {
  logo: 'M4 4h16v16H4z M8 15l4-6 4 6M9.5 13h5',
  sidebar: 'M3 5h18v14H3z M9 5v14m7-10-3 3 3 3',
  pointer: 'm6 4 1 15 4-4 6 1z',
  square: 'M5 5h14v14H5z',
  diamond: 'm12 3 9 9-9 9-9-9z',
  star: 'm12 3 2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z',
  snap: 'M4 5v7a8 8 0 0 0 16 0V5h-5v7a3 3 0 0 1-6 0V5zM4 9h5m6 0h5',
  hand: 'M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-2a5 5 0 0 1-4-2l-4-5a1.5 1.5 0 0 1 2-2z',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M21 12c0 3.3-4 6-9 6s-9-2.7-9-6 4-6 9-6 9 2.7 9 6z',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5m-7 0h7v7',
  pen: 'M4 18.5 5.3 14 16 3.3l4.7 4.7L10 18.7 5.5 20zM14.5 5l4.5 4.5',
  text: 'M6 7h12m-6 0v12m-3 0h6',
  undo: 'm8 7-4 4 4 4m-4-4h10a5 5 0 0 1 5 5v2',
  redo: 'm16 7 4 4-4 4m4-4H10a5 5 0 0 0-5 5v2',
  page: 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h8',
  chevron: 'm10 6 6 6-6 6',
  locate: 'M12 2v4m0 12v4M2 12h4m12 0h4M18 12a6 6 0 1 1-12 0 6 6 0 1 1 12 0z',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19',
  moon: 'M20.5 15.1A9 9 0 0 1 8.9 3.5 9 9 0 1 0 20.5 15.1z',
  notice: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7.5v5m0 3.5h.01',
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}
