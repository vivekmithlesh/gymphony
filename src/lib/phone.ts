export type PhoneCountryCodeOption = {
  code: string;
  label: string;
};

export const PHONE_COUNTRY_CODES: PhoneCountryCodeOption[] = [
  { code: "+1", label: "United States / Canada (+1)" },
  { code: "+7", label: "Russia / Kazakhstan (+7)" },
  { code: "+20", label: "Egypt (+20)" },
  { code: "+27", label: "South Africa (+27)" },
  { code: "+30", label: "Greece (+30)" },
  { code: "+31", label: "Netherlands (+31)" },
  { code: "+32", label: "Belgium (+32)" },
  { code: "+33", label: "France (+33)" },
  { code: "+34", label: "Spain (+34)" },
  { code: "+36", label: "Hungary (+36)" },
  { code: "+39", label: "Italy (+39)" },
  { code: "+40", label: "Romania (+40)" },
  { code: "+41", label: "Switzerland (+41)" },
  { code: "+43", label: "Austria (+43)" },
  { code: "+44", label: "United Kingdom (+44)" },
  { code: "+45", label: "Denmark (+45)" },
  { code: "+46", label: "Sweden (+46)" },
  { code: "+47", label: "Norway (+47)" },
  { code: "+48", label: "Poland (+48)" },
  { code: "+49", label: "Germany (+49)" },
  { code: "+52", label: "Mexico (+52)" },
  { code: "+55", label: "Brazil (+55)" },
  { code: "+57", label: "Colombia (+57)" },
  { code: "+61", label: "Australia (+61)" },
  { code: "+62", label: "Indonesia (+62)" },
  { code: "+63", label: "Philippines (+63)" },
  { code: "+64", label: "New Zealand (+64)" },
  { code: "+65", label: "Singapore (+65)" },
  { code: "+66", label: "Thailand (+66)" },
  { code: "+81", label: "Japan (+81)" },
  { code: "+82", label: "South Korea (+82)" },
  { code: "+84", label: "Vietnam (+84)" },
  { code: "+86", label: "China (+86)" },
  { code: "+90", label: "Turkey (+90)" },
  { code: "+91", label: "India (+91)" },
  { code: "+92", label: "Pakistan (+92)" },
  { code: "+94", label: "Sri Lanka (+94)" },
  { code: "+95", label: "Myanmar (+95)" },
  { code: "+98", label: "Iran (+98)" },
  { code: "+212", label: "Morocco (+212)" },
  { code: "+213", label: "Algeria (+213)" },
  { code: "+234", label: "Nigeria (+234)" },
  { code: "+254", label: "Kenya (+254)" },
  { code: "+255", label: "Tanzania (+255)" },
  { code: "+256", label: "Uganda (+256)" },
  { code: "+260", label: "Zambia (+260)" },
  { code: "+264", label: "Namibia (+264)" },
  { code: "+267", label: "Botswana (+267)" },
  { code: "+351", label: "Portugal (+351)" },
  { code: "+352", label: "Luxembourg (+352)" },
  { code: "+353", label: "Ireland (+353)" },
  { code: "+354", label: "Iceland (+354)" },
  { code: "+356", label: "Malta (+356)" },
  { code: "+358", label: "Finland (+358)" },
  { code: "+359", label: "Bulgaria (+359)" },
  { code: "+370", label: "Lithuania (+370)" },
  { code: "+371", label: "Latvia (+371)" },
  { code: "+372", label: "Estonia (+372)" },
  { code: "+380", label: "Ukraine (+380)" },
  { code: "+381", label: "Serbia (+381)" },
  { code: "+385", label: "Croatia (+385)" },
  { code: "+386", label: "Slovenia (+386)" },
  { code: "+420", label: "Czech Republic (+420)" },
  { code: "+421", label: "Slovakia (+421)" },
  { code: "+852", label: "Hong Kong (+852)" },
  { code: "+853", label: "Macau (+853)" },
  { code: "+855", label: "Cambodia (+855)" },
  { code: "+856", label: "Laos (+856)" },
  { code: "+880", label: "Bangladesh (+880)" },
  { code: "+886", label: "Taiwan (+886)" },
  { code: "+971", label: "United Arab Emirates (+971)" },
  { code: "+972", label: "Israel (+972)" },
  { code: "+973", label: "Bahrain (+973)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+975", label: "Bhutan (+975)" },
  { code: "+976", label: "Mongolia (+976)" },
  { code: "+977", label: "Nepal (+977)" },
  { code: "+992", label: "Tajikistan (+992)" },
  { code: "+994", label: "Azerbaijan (+994)" },
  { code: "+995", label: "Georgia (+995)" },
  { code: "+996", label: "Kyrgyzstan (+996)" },
  { code: "+998", label: "Uzbekistan (+998)" },
].sort((left, right) => right.code.length - left.code.length);

export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
export const INTERNATIONAL_PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export const cleanPhoneInput = (value?: string) => {
  return (value || "").trim().replace(/[()\s-]/g, "");
};

export const isValidInternationalPhone = (value?: string) => {
  const cleaned = cleanPhoneInput(value);
  return INTERNATIONAL_PHONE_REGEX.test(cleaned);
};

export const normalizeToE164Phone = (value?: string, countryCode: string = "+1") => {
  const cleaned = cleanPhoneInput(value);
  if (!cleaned) return "";

  if (cleaned.startsWith("+")) {
    return E164_PHONE_REGEX.test(cleaned) ? cleaned : "";
  }

  const digits = cleaned.replace(/\D/g, "");
  const prefix = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const candidate = `${prefix}${digits}`;

  return E164_PHONE_REGEX.test(candidate) ? candidate : "";
};

export const e164ToDisplayParts = (value?: string, defaultCountryCode: string = "+1") => {
  const cleaned = cleanPhoneInput(value);

  if (!cleaned) {
    return { countryCode: defaultCountryCode, localNumber: "" };
  }

  if (!cleaned.startsWith("+")) {
    return { countryCode: defaultCountryCode, localNumber: cleaned.replace(/\D/g, "") };
  }

  const matchingCountry = PHONE_COUNTRY_CODES.find((option) => cleaned.startsWith(option.code));
  if (matchingCountry) {
    return {
      countryCode: matchingCountry.code,
      localNumber: cleaned.slice(matchingCountry.code.length).replace(/\D/g, ""),
    };
  }

  const digits = cleaned.replace(/\D/g, "");
  return { countryCode: defaultCountryCode, localNumber: digits };
};

export const phoneForWaMe = (value?: string) => {
  const cleaned = cleanPhoneInput(value);
  return cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
};