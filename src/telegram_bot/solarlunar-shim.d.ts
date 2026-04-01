declare module "solarlunar" {
  export interface SolarLunarResult {
    lYear: number;
    lMonth: number;
    lDay: number;
    animal: string;
    yearCn: string;
    monthCn: string;
    dayCn: string;
    cYear: number;
    cMonth: number;
    cDay: number;
    gzYear: string;
    gzMonth: string;
    gzDay: string;
    isToday: boolean;
    isLeap: boolean;
    nWeek: number;
    ncWeek: string;
    isTerm: boolean;
    term: string;
  }

  const solarLunar: {
    leapMonth(y: number): number;
    toChinaMonth(m: number): string;
    toChinaDay(d: number): string;
    solar2lunar(year?: number, month?: number, day?: number): SolarLunarResult | -1;
    lunar2solar(year: number, month: number, day: number, isLeapMonth?: boolean): SolarLunarResult | -1;
  };

  export default solarLunar;
}
