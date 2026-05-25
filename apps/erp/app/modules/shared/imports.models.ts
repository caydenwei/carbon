import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// to avoid a circular dependency
const methodType = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;
const itemReplenishmentSystems = ["Buy", "Make", "Buy and Make"] as const;
const itemTrackingTypes = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch"
] as const;

export const fieldMappings = {
  customer: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    accountManagerId: {
      label: "Account Manager",
      required: false,
      type: "enum",
      enumData: {
        description: "The account manager of the customer",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("employees")
            .select("id, name, avatarUrl")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string"
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string"
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string"
    },
    website: {
      label: "Website",
      required: false,
      type: "string"
    }
  },
  customerContact: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    companyId: {
      label: "External Company ID",
      required: true,
      type: "string"
    },
    firstName: {
      label: "First Name",
      required: true,
      type: "string"
    },
    lastName: {
      label: "Last Name",
      required: true,
      type: "string"
    },
    email: {
      label: "Email",
      type: "string",
      required: true
    },
    title: {
      label: "Title",
      type: "string",
      required: false
    },
    mobilePhone: {
      label: "Mobile Phone",
      type: "string",
      required: false
    },
    workPhone: {
      label: "Work Phone",
      type: "string",
      required: false
    },
    homePhone: {
      label: "Home Phone",
      type: "string",
      required: false
    },
    fax: {
      label: "Fax",
      type: "string",
      required: false
    },
    notes: {
      label: "Notes",
      type: "string",
      required: false
    }
  },
  supplier: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    accountManagerId: {
      label: "Account Manager",
      required: false,
      type: "enum",
      enumData: {
        description: "The account manager of the customer",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("employees")
            .select("id, name, avatarUrl")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    phone: {
      label: "Phone",
      required: false,
      type: "string"
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string"
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string"
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string"
    },
    website: {
      label: "Website",
      required: false,
      type: "string"
    }
  },
  supplierContact: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    companyId: {
      label: "External Company ID",
      required: true,
      type: "string"
    },
    firstName: {
      label: "First Name",
      required: true,
      type: "string"
    },
    lastName: {
      label: "Last Name",
      required: true,
      type: "string"
    },
    email: {
      label: "Email",
      type: "string",
      required: true
    },
    title: {
      label: "Title",
      type: "string",
      required: false
    },
    mobilePhone: {
      label: "Mobile Phone",
      type: "string",
      required: false
    },
    workPhone: {
      label: "Work Phone",
      type: "string",
      required: false
    },
    homePhone: {
      label: "Home Phone",
      type: "string",
      required: false
    },
    fax: {
      label: "Fax",
      type: "string",
      required: false
    },
    notes: {
      label: "Notes",
      type: "string",
      required: false
    }
  },
  part: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string"
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  tool: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string"
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  fixture: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string"
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  consumable: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string"
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  material: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string"
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    materialSubstanceId: {
      label: "Substance",
      required: true,
      type: "enum",
      enumData: {
        description: "The substance of the material",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("materialSubstance")
            .select("id, name")
            .or(`companyId.eq.${companyId},companyId.is.null`)
            .order("name");
        },
        default: ""
      }
    },
    materialFormId: {
      label: "Form",
      required: false,
      type: "enum",
      enumData: {
        description: "The form of the material",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("materialForm")
            .select("id, name")
            .or(`companyId.eq.${companyId},companyId.is.null`)
            .order("name");
        },
        default: ""
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: ["Purchase to Order", "Pull from Inventory", "Make to Order"],
        default: "Purchase to Order"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    finish: {
      label: "Finish",
      type: "string",
      required: false
    },
    grade: {
      label: "Grade",
      type: "string",
      required: false
    },
    dimensions: {
      label: "Dimensions",
      type: "string",
      required: false
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  methodMaterial: {
    level: {
      label: "Level",
      required: false,
      type: "string"
    },
    partId: {
      label: "Part ID",
      required: true,
      type: "string"
    },
    description: {
      label: "Description",
      required: false,
      type: "string"
    },
    methodType: {
      label: "Method Type",
      required: true,
      type: "enum",
      enumData: {
        description:
          "The method type of the part, which describes whether it is bought or made",
        options: methodType,
        default: "Pull from Inventory"
      }
    },
    quantity: {
      label: "Quantity",
      required: true,
      type: "number"
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: true,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    }
  },
  workCenter: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    description: {
      label: "Description",
      required: true,
      type: "string"
    },
    defaultStandardFactor: {
      label: "Standard Factor",
      required: false,
      type: "enum",
      enumData: {
        description: "The standard factor unit for time tracking",
        options: [
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ],
        default: "Hours/Piece"
      }
    },
    laborRate: {
      label: "Labor Rate",
      required: true,
      type: "number"
    },
    machineRate: {
      label: "Machine Rate",
      required: true,
      type: "number"
    },
    overheadRate: {
      label: "Overhead Rate",
      required: true,
      type: "number"
    },
    locationId: {
      label: "Location",
      required: true,
      type: "enum",
      enumData: {
        description: "The location of the work center",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("location")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    }
  },
  process: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    processType: {
      label: "Process Type",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether the process is Inside (in-house), Outside (outsourced), or both",
        options: ["Inside", "Outside", "Inside and Outside"],
        default: "Inside"
      }
    },
    defaultStandardFactor: {
      label: "Standard Factor",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The standard factor unit for time tracking (required for Inside processes)",
        options: [
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ],
        default: "Hours/Piece"
      }
    },
    completeAllOnScan: {
      label: "Complete All On Scan",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether scanning a barcode should complete all operations for this process",
        options: ["true", "false"],
        default: "false"
      }
    }
  },
  fixedAsset: {
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    fixedAssetClassId: {
      label: "Asset Class ID",
      required: true,
      type: "string"
    },
    serialNumber: {
      label: "Serial Number",
      required: false,
      type: "string"
    },
    acquisitionCost: {
      label: "Acquisition Cost",
      required: true,
      type: "string"
    },
    acquisitionDate: {
      label: "Acquisition Date",
      required: true,
      type: "string"
    },
    accumulatedDepreciation: {
      label: "Accumulated Depreciation",
      required: false,
      type: "string"
    },
    depreciationMethod: {
      label: "Depreciation Method",
      required: false,
      type: "enum",
      enumData: {
        description: "The depreciation method for this asset",
        options: ["Straight Line", "Declining Balance", "Units of Production"],
        default: "Straight Line"
      }
    },
    usefulLifeMonths: {
      label: "Useful Life (Months)",
      required: false,
      type: "string"
    },
    residualValuePercent: {
      label: "Residual Value %",
      required: false,
      type: "string"
    },
    locationId: {
      label: "Location ID",
      required: false,
      type: "string"
    }
  }
} as const;

export const importPermissions: Record<keyof typeof fieldMappings, string> = {
  customer: "sales",
  customerContact: "sales",
  supplier: "purchasing",
  supplierContact: "purchasing",
  part: "parts",
  material: "parts",
  methodMaterial: "parts",
  tool: "parts",
  fixture: "parts",
  consumable: "parts",
  workCenter: "production",
  process: "production",
  fixedAsset: "accounting"
};

export const importSchemas: Record<
  keyof typeof fieldMappings,
  z.ZodObject<any>
> = {
  customer: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the customer, usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe(
        "The name of the customer. Sometimes contains Inc or LLC. Usually a proper noun."
      ),
    accountManagerId: z
      .string()
      .optional()
      .describe("The id of the account manager of the customer"),
    phone: z.string().optional().describe("The phone number of the customer"),
    fax: z.string().optional().describe("The fax number of the customer"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the customer. Usually numeric."
      )
      .nullable(),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the customer. Usually a 3-letter code.")
      .nullable(),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://")
      .nullable()
  }),
  customerContact: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the customer contact, usually a number or set of alphanumeric characters."
      ),
    companyId: z
      .string()
      .min(1, { message: "Company ID is required" })
      .describe("The id of the company the contact belongs to"),
    firstName: z.string().describe("The first name of the customer contact"),
    lastName: z.string().describe("The last name of the customer contact"),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .describe("The email of the customer contact"),
    title: z.string().optional().describe("The title of the customer contact"),
    mobilePhone: z
      .string()
      .optional()
      .describe("The mobile phone of the customer contact"),
    workPhone: z
      .string()
      .optional()
      .describe("The work phone of the customer contact"),
    homePhone: z
      .string()
      .optional()
      .describe("The home phone of the customer contact"),
    fax: z.string().optional().describe("The fax of the customer contact"),
    notes: z.string().optional().describe("The notes of the customer contact")
  }),
  supplier: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the supplier, usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe(
        "The name of the supplier. Sometimes contains Inc or LLC. Usually a proper noun."
      ),
    accountManagerId: z
      .string()
      .optional()
      .describe("The id of the account manager of the supplier"),
    phone: z.string().optional().describe("The phone number of the supplier"),
    fax: z.string().optional().describe("The fax number of the supplier"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the supplier. Usually numeric."
      )
      .nullable(),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the supplier. Usually a 3-letter code.")
      .nullable(),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://")
      .nullable()
  }),
  supplierContact: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the supplier contact, usually a number or set of alphanumeric characters."
      ),
    companyId: z
      .string()
      .min(1, { message: "Company ID is required" })
      .describe("The id of the company the contact belongs to"),
    firstName: z
      .string()
      .describe("The first name of the supplier contact")
      .optional(),
    lastName: z
      .string()
      .describe("The last name of the supplier contact")
      .optional(),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .describe("The email of the supplier contact"),
    title: z.string().optional().describe("The title of the supplier contact"),
    mobilePhone: z
      .string()
      .optional()
      .describe("The mobile phone of the supplier contact"),
    workPhone: z
      .string()
      .optional()
      .describe("The work phone of the supplier contact"),
    homePhone: z
      .string()
      .optional()
      .describe("The home phone of the supplier contact"),
    fax: z.string().optional().describe("The fax of the supplier contact"),
    notes: z.string().optional().describe("The notes of the supplier contact")
  }),
  part: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the part, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the part. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the part"),
    description: z
      .string()
      .optional()
      .describe("The long description of the part"),
    active: z.string().optional().describe("Whether the part is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the part"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the part"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the part"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the part")
  }),
  tool: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the tool, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the tool. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the tool"),
    description: z
      .string()
      .optional()
      .describe("The long description of the tool"),
    active: z.string().optional().describe("Whether the tool is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the tool"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the tool"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the tool"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the tool")
  }),
  fixture: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the fixture, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the fixture. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the fixture"),
    description: z
      .string()
      .optional()
      .describe("The long description of the fixture"),
    active: z.string().optional().describe("Whether the fixture is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the fixture"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the fixture"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the fixture"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the fixture")
  }),
  consumable: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the part, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the part. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the part"),
    description: z
      .string()
      .optional()
      .describe("The long description of the part"),
    active: z.string().optional().describe("Whether the part is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the part"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the part"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the part"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the part")
  }),
  material: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the material, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the material. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the material"),
    description: z
      .string()
      .optional()
      .describe("The long description of the material"),
    active: z.string().optional().describe("Whether the material is active"),
    materialSubstanceId: z
      .string()
      .optional()
      .describe("The substance of the material"),
    materialFormId: z.string().optional().describe("The form of the material"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the material"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the material"),
    finish: z.string().optional().describe("The finish of the material"),
    grade: z.string().optional().describe("The grade of the material"),
    dimensions: z
      .string()
      .optional()
      .describe("The dimensions of the material"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the material")
  }),
  methodMaterial: z.object({
    level: z.string().optional().describe("The level of the material"),
    partId: z
      .string()
      .min(1, { message: "Part ID is required" })
      .describe("The id of the part"),
    description: z.string().optional().describe("The description of the part"),
    quantity: z.string().describe("The quantity of the part"),
    methodType: z
      .string()
      .optional()
      .describe(
        "The method type of the part, which describes whether it is bought or made"
      ),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the part")
  }),
  workCenter: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe("The unique ID of the work center"),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the work center"),
    description: z
      .string()
      .min(1, { message: "Description is required" })
      .describe("The description of the work center"),
    defaultStandardFactor: z
      .string()
      .optional()
      .describe("The standard factor unit for time tracking"),
    laborRate: z.string().describe("The labor rate for the work center"),
    machineRate: z.string().describe("The machine rate for the work center"),
    overheadRate: z.string().describe("The overhead rate for the work center"),
    locationId: z
      .string()
      .min(1, { message: "Location is required" })
      .describe("The location ID of the work center")
  }),
  process: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe("The unique ID of the process"),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the process"),
    processType: z
      .string()
      .optional()
      .describe(
        "Whether the process is Inside (in-house), Outside (outsourced), or both"
      ),
    defaultStandardFactor: z
      .string()
      .optional()
      .describe(
        "The standard factor unit for time tracking (required for Inside processes)"
      ),
    completeAllOnScan: z
      .string()
      .optional()
      .describe(
        "Whether scanning a barcode should complete all operations for this process"
      )
  }),
  fixedAsset: z.object({
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the fixed asset"),
    fixedAssetClassId: z
      .string()
      .min(1, { message: "Asset Class is required" })
      .describe("The ID of the fixed asset class"),
    serialNumber: z
      .string()
      .optional()
      .describe("The serial number of the asset"),
    acquisitionCost: z
      .string()
      .optional()
      .describe("The acquisition cost of the asset"),
    acquisitionDate: z
      .string()
      .optional()
      .describe("The date the asset was acquired (YYYY-MM-DD)"),
    accumulatedDepreciation: z
      .string()
      .optional()
      .describe("The accumulated depreciation to date"),
    depreciationMethod: z
      .string()
      .optional()
      .describe(
        "The depreciation method: Straight Line, Declining Balance, or Units of Production"
      ),
    usefulLifeMonths: z
      .string()
      .optional()
      .describe("The useful life of the asset in months"),
    residualValuePercent: z
      .string()
      .optional()
      .describe("The residual value as a percentage of acquisition cost"),
    locationId: z
      .string()
      .optional()
      .describe("The location ID where the asset is located")
  })
} as const;
