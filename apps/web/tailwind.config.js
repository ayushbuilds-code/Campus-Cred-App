/** Design tokens: petrol ink, pale sage paper, teal brand, saffron accent. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#10242B', 80: '#34474D', 60: '#5B6B6F', 40: '#8A9799' },
        paper: '#F3F5F2',
        line: '#D9DED8',
        brand: { DEFAULT: '#0E6B63', dark: '#0A524C', tint: '#E3F0EE' },
        saffron: { DEFAULT: '#E39B0B', tint: '#FBF0D6' },
        danger: { DEFAULT: '#B3261E', tint: '#FBE7E5' },
        ok: { DEFAULT: '#1B7F4B', tint: '#E1F3E8' },
        warn: { DEFAULT: '#8A5A00', tint: '#FBF0D6' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Figtree Variable"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px' },
    },
  },
  plugins: [],
};
