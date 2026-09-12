import { Annotation } from "@langchain/langgraph";
import type {
  Criterion,
  Disqualifier,
  DomainKnowledge,
  DomainTerm,
  Icp,
  ProductDefinition,
} from "@/lib/types";

export type RawSource = {
  kind: "website" | "pdf" | "link" | "research";
  uri: string;
  title?: string;
  text: string;
};

const concat = <T,>() => ({
  reducer: (left: T[], right: T[]) => [...left, ...right],
  default: (): T[] => [],
});

export const ProfileStateAnnotation = Annotation.Root({
  productId: Annotation<string>,
  productName: Annotation<string>,
  websiteUrl: Annotation<string | undefined>,
  fileIds: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  links: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),

  /** Fanned-out ingest nodes all append here, so the reducer concatenates. */
  rawSources: Annotation<RawSource[]>(concat<RawSource>()),
  /** Pages we actually read, used to enforce evidence on domain language. */
  evidenceUrls: Annotation<string[]>(concat<string>()),

  productDefinition: Annotation<ProductDefinition | undefined>,
  icp: Annotation<Icp | undefined>,
  domainKnowledge: Annotation<DomainKnowledge | undefined>,
  domainLanguage: Annotation<DomainTerm[] | undefined>,
  disqualifiers: Annotation<Disqualifier[] | undefined>,
  scoringCriteria: Annotation<Criterion[] | undefined>,

  profileId: Annotation<string | undefined>,
  errors: Annotation<string[]>(concat<string>()),
});

export type ProfileState = typeof ProfileStateAnnotation.State;
export type ProfileUpdate = typeof ProfileStateAnnotation.Update;
