/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // --- REFACTOR HIGHLIGHT ---
  // 디자인 예시의 테마(색상, 폰트, radius 등)를 그대로 적용
  theme: {
    extend: {
      colors: {
        primary: "#253C5F",
        primaryLight: "#3869C5",
        background: "#FFFFFF",
        panelBackground: "#F7F7F8",
        accent: "#3869C5",
        error: "#F45B5B",
        warning: "#FFC847",
        success: "#51C392",
        info: "#A0B4D6",
        disabled: "#C9C9C9",
        border: "#E1E1E6",
      },
      fontFamily: {
        sans: ["Noto Sans KR", "sans-serif"],
      },
      fontSize: {
        title: "22px",
        section: "18px",
        body: "16px",
        caption: "13px",
      },
      borderRadius: { card: "12px", modal: "16px", lg: "10px", full: "9999px" },
    },
  },
  plugins: [],
};
