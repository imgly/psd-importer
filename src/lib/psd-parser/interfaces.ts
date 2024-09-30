interface PsdColor {
  Values: Array<number>;
  Type: number;
}

interface StyleSheetData {
  DiacriticPos: number;
  Kashida: number;
  HindiNumbers: boolean;
  CharacterDirection: number;
  OutlineWidth: number;
  YUnderline: number;
  FillFirst: boolean;
  StrokeFlag: boolean;
  FillFlag: boolean;
  StrokeColor: PsdColor;
  FillColor: PsdColor;
  NoBreak: boolean;
  Language: number;
  StyleRunAlignment: number;
  Tsume: number;
  BaselineDirection: number;
  DLigatures: boolean;
  Ligatures: boolean;
  Strikethrough: boolean;
  Underline: boolean;
  FontBaseline: number;
  FontCaps: number;
  BaselineShift: number;
  Kerning: number;
  AutoKerning: boolean;
  Tracking: number;
  VerticalScale: number;
  HorizontalScale: number;
  Leading: number;
  AutoLeading: boolean;
  FauxItalic: boolean;
  FauxBold: boolean;
  FontSize: number;
  Font: number;
}

interface StyleSheetSetItem {
  StyleSheetData: StyleSheetData;
  Name: string;
}

interface FontSetitem {
  Synthetic: number;
  FontType: number;
  Script: number;
  Name: string;
}

interface DocumentResources {
  SmallCapSize: number;
  SubscriptPosition: number;
  SubscriptSize: number;
  SuperscriptPosition: number;
  SuperscriptSize: number;
  FontSet: Array<FontSetitem>;
  StyleSheetSet: Array<StyleSheetSetItem>;
  ParagraphSheetSet: Array<ParagraphSheet>;
}

interface ResourceDict {
  SmallCapSize: number;
  SubscriptPosition: number;
  SubscriptSize: number;
  SuperscriptPosition: number;
  SuperscriptSize: number;
  FontSet: Array<FontSetitem>;
  StyleSheetSet: Array<StyleSheetSetItem>;
  ParagraphSheetSet: Array<ParagraphSheet>;
}

interface StyleRunArrayItem {
  StyleSheet: {
    StyleSheetData: StyleSheetData;
  };
}

interface ParagraphSheet {
  Properties: {
    EveryLineComposer: boolean;
    KinsokuOrder: number;
    Burasagari: boolean;
    Hanging: boolean;
    LeadingType: number;
    AutoLeading: number;
    GlyphSpacing: Array<number>;
    LetterSpacing: Array<number>;
    WordSpacing: Array<number>;
    Zone: number;
    ConsecutiveHyphens: number;
    PostHyphen: number;
    PreHyphen: number;
    HyphenatedWordSize: number;
    AutoHyphenate: boolean;
    SpaceAfter: number;
    SpaceBefore: number;
    EndIndent: number;
    StartIndent: number;
    FirstLineIndent: number;
    Justification: number;
  };
  DefaultStyleSheet: number;
  Name: string;
}

interface ParagraphRunArrayItem {
  Adjustments: {
    XY: Array<number>;
    Axis: Array<number>;
  };
  ParagraphSheet: ParagraphSheet;
  DefaultStyleSheet: number;
}

interface EngineDict {
  StyleRun: {
    IsJoinable: number;
    RunLengthArray: Array<number>;
    RunArray: Array<StyleRunArrayItem>;
    DefaultRunData: StyleRunArrayItem;
  };
  ParagraphRun: {
    IsJoinable: number;
    RunLengthArray: Array<number>;
    RunArray: Array<ParagraphRunArrayItem>;
    DefaultRunData: ParagraphRunArrayItem;
  };
  Rendered: any;
}

export interface TextProperties {
  DocumentResources: DocumentResources;
  ResourceDict: ResourceDict;
  EngineDict: EngineDict;
}

export interface VectorNumberTypeItem {
  type: string;
  value: number;
}

export interface VectorBooleanTypeItem {
  type: string;
  value: boolean;
}

export interface VectorObjectTypeItem {
  type: string;
  descriptor: {
    name: string;
    classId: string;
    items: Map<string, object>;
  };
}

export interface VectorUnitTypeItem {
  type: string;
  unitType: string;
  value: number;
}

export type Point = {
  vert: number;
  horiz: number;
};
export interface VectorPathRecordItem {
  type: number;
  preceding: Point;
  anchor: Point;
  leaving: Point;
}

export interface PartialLayerFrame {
  layerFrame: {
    id: number;
    layerProperties: {
      groupId: number;
    };
  };
}
