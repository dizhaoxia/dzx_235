import React from 'react';
import { useSlate } from 'slate-react';
import { Editor as SlateEditor, Transforms, Element as SlateElement } from 'slate';

interface ToolbarProps {
  editor: SlateEditor;
}

const CustomEditor = {
  isBoldMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.bold === true : false;
  },

  isItalicMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.italic === true : false;
  },

  isUnderlineMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.underline === true : false;
  },

  isCodeMarkActive(editor: SlateEditor) {
    const marks: any = SlateEditor.marks(editor);
    return marks ? marks.code === true : false;
  },

  isBlockActive(editor: SlateEditor, format: string) {
    const { selection } = editor;
    if (!selection) return false;

    const [match] = Array.from(
      SlateEditor.nodes(editor, {
        at: SlateEditor.unhangRange(editor, selection),
        match: n => !SlateEditor.isEditor(n) &&
          (n as any).type === format
      })
    );

    return !!match;
  },

  toggleBoldMark(editor: SlateEditor) {
    const isActive = CustomEditor.isBoldMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'bold');
    } else {
      SlateEditor.addMark(editor, 'bold', true);
    }
  },

  toggleItalicMark(editor: SlateEditor) {
    const isActive = CustomEditor.isItalicMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'italic');
    } else {
      SlateEditor.addMark(editor, 'italic', true);
    }
  },

  toggleUnderlineMark(editor: SlateEditor) {
    const isActive = CustomEditor.isUnderlineMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'underline');
    } else {
      SlateEditor.addMark(editor, 'underline', true);
    }
  },

  toggleCodeMark(editor: SlateEditor) {
    const isActive = CustomEditor.isCodeMarkActive(editor);
    if (isActive) {
      SlateEditor.removeMark(editor, 'code');
    } else {
      SlateEditor.addMark(editor, 'code', true);
    }
  },

  toggleBlock(editor: SlateEditor, format: string) {
    const isActive = CustomEditor.isBlockActive(editor, format);
    const isList = format === 'bulleted-list' || format === 'numbered-list';
    const newType = isActive ? 'paragraph' : isList ? 'list-item' : format;

    Transforms.unwrapNodes(editor, {
      match: (n) => !SlateEditor.isEditor(n) &&
        SlateElement.isElement(n) &&
        ['bulleted-list', 'numbered-list'].includes((n as any).type),
      split: true
    });

    Transforms.setNodes(editor, { type: newType } as any);

    if (!isActive && isList) {
      const block = { type: format, children: [] } as any;
      Transforms.wrapNodes(editor, block);
    }
  }
};

const MarkButton: React.FC<{
  format: string;
  icon: string;
  title: string;
}> = ({ format, icon, title }) => {
  const editor = useSlate();

  const isActive = (() => {
    switch (format) {
      case 'bold': return CustomEditor.isBoldMarkActive(editor);
      case 'italic': return CustomEditor.isItalicMarkActive(editor);
      case 'underline': return CustomEditor.isUnderlineMarkActive(editor);
      case 'code': return CustomEditor.isCodeMarkActive(editor);
      default: return false;
    }
  })();

  return (
    <button
      className={`toolbar-btn ${isActive ? 'active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        switch (format) {
          case 'bold': CustomEditor.toggleBoldMark(editor); break;
          case 'italic': CustomEditor.toggleItalicMark(editor); break;
          case 'underline': CustomEditor.toggleUnderlineMark(editor); break;
          case 'code': CustomEditor.toggleCodeMark(editor); break;
        }
      }}
      title={title}
    >
      {icon}
    </button>
  );
};

const BlockButton: React.FC<{
  format: string;
  icon: string;
  title: string;
}> = ({ format, icon, title }) => {
  const editor = useSlate();
  const isActive = CustomEditor.isBlockActive(editor, format);

  return (
    <button
      className={`toolbar-btn ${isActive ? 'active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        CustomEditor.toggleBlock(editor, format);
      }}
      title={title}
    >
      {icon}
    </button>
  );
};

const Toolbar: React.FC<ToolbarProps> = () => {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <BlockButton format="heading-one" icon="H1" title="一级标题" />
        <BlockButton format="heading-two" icon="H2" title="二级标题" />
        <BlockButton format="heading-three" icon="H3" title="三级标题" />
      </div>

      <div className="toolbar-divider"></div>

      <div className="toolbar-group">
        <MarkButton format="bold" icon="B" title="加粗" />
        <MarkButton format="italic" icon="I" title="斜体" />
        <MarkButton format="underline" icon="U" title="下划线" />
        <MarkButton format="code" icon="</>" title="行内代码" />
      </div>

      <div className="toolbar-divider"></div>

      <div className="toolbar-group">
        <BlockButton format="bulleted-list" icon="•" title="无序列表" />
        <BlockButton format="numbered-list" icon="1." title="有序列表" />
        <BlockButton format="block-quote" icon="❝" title="引用" />
      </div>
    </div>
  );
};

export default Toolbar;
