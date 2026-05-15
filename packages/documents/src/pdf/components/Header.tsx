import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { Company } from "../../types";

type HeaderProps = {
  company: Company;
  title: string;
  documentId?: string | null;
  date?: string | null;
  currencyCode?: string | null;
  locale?: string;
  /**
   * When true, the header is wrapped in <View fixed> so it repeats on
   * every page. Used by PO PDF; sales PDFs default to non-fixed (page 1 only).
   */
  fixed?: boolean;
};

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const Header = ({ company, title, documentId, fixed }: HeaderProps) => {
  const headerView = (
    <View style={tw("flex flex-row justify-between mb-1")}>
      <View style={tw("flex flex-row")}>
        {company.logoLightIcon ? (
          <Image
            src={company.logoLightIcon}
            style={{ height: 50, width: "auto", marginRight: 12 }}
          />
        ) : (
          <Text
            style={tw("text-2xl font-bold text-gray-800 tracking-tight mr-3")}
          >
            {company.name}
          </Text>
        )}
        <View style={tw("flex flex-col text-[9px] text-gray-800")}>
          {company.name && <Text style={tw("font-bold")}>{company.name}</Text>}
          {company.addressLine1 && <Text>{company.addressLine1}</Text>}
          {company.addressLine2 && <Text>{company.addressLine2}</Text>}
          {(company.city ||
            company.stateProvince ||
            company.postalCode ||
            company.countryCode) && (
            <Text>
              {[
                formatCityStatePostalCode(
                  company.city,
                  company.stateProvince,
                  company.postalCode
                ),
                company.countryCode
              ]
                .filter(Boolean)
                .join(" ")}
            </Text>
          )}
        </View>
      </View>
      <View style={tw("flex flex-col items-end justify-start")}>
        <Text style={tw("text-2xl font-bold text-gray-800 tracking-tight")}>
          {title}
        </Text>
        {documentId && (
          <Text
            style={tw("text-sm font-bold text-gray-600 tracking-tight -mt-4")}
          >
            {documentId}
          </Text>
        )}
      </View>
    </View>
  );

  if (fixed) {
    return (
      <>
        <View fixed>{headerView}</View>
        <View fixed style={tw("h-[1px] bg-gray-200 mb-4")} />
      </>
    );
  }

  return (
    <>
      {headerView}
      <View style={tw("h-[1px] bg-gray-200 mb-4")} />
    </>
  );
};

export { Header };
