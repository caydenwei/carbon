import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"]
    }
  }
});

interface FooterProps {
  label?: string;
  documentId?: string | null;
}

const Footer = ({ label, documentId }: FooterProps) => {
  return (
    <View
      style={[
        tw("absolute bottom-0 left-0 right-0 pb-5"),
        { paddingLeft: 16, paddingRight: 16 }
      ]}
      fixed
    >
      <View style={tw("border-t border-gray-200 pt-3")}>
        <View
          style={tw(
            "flex flex-row justify-between items-center text-xs text-gray-500 px-1"
          )}
        >
          <Text>{label ?? ""}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${documentId ? `${documentId}   ` : ""}Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </View>
    </View>
  );
};

export default Footer;
