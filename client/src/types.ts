import { BaseEditor, Descendant } from 'slate';
import { ReactEditor } from 'slate-react';
import { HistoryEditor } from 'slate-history';
import { YjsEditor } from 'slate-yjs';

type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
};

type CustomElement = {
  type: 'paragraph' | 'heading-one' | 'heading-two' | 'heading-three' | 'block-quote' | 'bulleted-list' | 'numbered-list' | 'list-item';
  children: CustomText[];
};

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor & YjsEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
