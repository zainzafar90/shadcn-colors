import * as vscode from "vscode";
import * as colorConvert from "color-convert";
import * as validateColor from "validate-color";

interface ColorMatch {
  range: vscode.Range;
  hue: number;
  saturation: number;
  lightness: number;
}

class ShadcnColors {
  private static readonly DEBOUNCE_DELAY = 500;
  private static readonly COLOR_VAR_REGEX =
    /--[\w-]+:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;?/g;

  private readonly decorationType: vscode.TextEditorDecorationType;
  private activeEditor: vscode.TextEditor | undefined;
  private debounceTimeout: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.decorationType = this.createDecorationType();
    this.activeEditor = vscode.window.activeTextEditor;
    this.initialize();
  }

  private createDecorationType(): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({});
  }

  private initialize(): void {
    if (this.activeEditor) {
      this.triggerUpdate();
    }

    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.activeEditor = editor;
        if (editor) {
          this.triggerUpdate();
        }
      }),

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.activeEditor &&
          event.document === this.activeEditor.document
        ) {
          this.triggerUpdate();
        }
      }),

      vscode.commands.registerCommand(
        "shadcn-colors.toggleColors",
        this.toggleColorDecorations.bind(this)
      ),

      vscode.commands.registerCommand(
        "shadcn-colors.changeColor",
        this.handleColorChange.bind(this)
      )
    );

    this.updateDecorations();
  }

  private triggerUpdate(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(
      () => this.updateDecorations(),
      ShadcnColors.DEBOUNCE_DELAY
    );
  }

  private findColorMatches(text: string): ColorMatch[] {
    const matches: ColorMatch[] = [];
    let match: RegExpExecArray | null;

    while ((match = ShadcnColors.COLOR_VAR_REGEX.exec(text))) {
      const startPos = this.activeEditor!.document.positionAt(match.index);
      const endPos = this.activeEditor!.document.positionAt(
        match.index + match[0].length
      );

      matches.push({
        range: new vscode.Range(startPos, endPos),
        hue: parseFloat(match[1]),
        saturation: parseFloat(match[2]),
        lightness: parseFloat(match[3]),
      });
    }

    return matches;
  }

  private createDecorationOptions(
    matches: ColorMatch[]
  ): vscode.DecorationOptions[] {
    const isEnabled = this.context.globalState.get(
      "shadcnColorsEnabled",
      false
    );

    return matches.map((match) => {
      const hexColor = `#${colorConvert.hsl.hex([
        match.hue,
        match.saturation,
        match.lightness,
      ])}`;

      if (!isEnabled) {
        return {
          range: match.range,
        };
      }

      return {
        range: match.range,
        hoverMessage: `Hue: ${match.hue}°\nSaturation: ${match.saturation}%\nLightness: ${match.lightness}%\nHex: ${hexColor}`,
        renderOptions: {
          after: {
            contentText: `${hexColor}`,
            textDecoration: `display: inline-block; border: 1px solid ${
              match.lightness > 50
                ? "rgba(0,0,0,0.25)"
                : "rgba(255,255,255,0.25)"
            };
                border-radius: 3px; margin-left: 1rem; padding: 1px 4px; background-color: ${hexColor};
                color: ${match.lightness > 50 ? "#000" : "#fff"};`,
          },
        },
      };
    });
  }

  private updateDecorations(): void {
    if (!this.activeEditor) {
      return;
    }

    const text = this.activeEditor.document.getText();
    const matches = this.findColorMatches(text);
    const decorations = this.createDecorationOptions(matches);
    this.activeEditor.setDecorations(this.decorationType, decorations);
  }

  private toggleColorDecorations(): void {
    const isEnabled = this.context.globalState.get(
      "shadcnColorsEnabled",
      false
    );
    this.context.globalState.update("shadcnColorsEnabled", !isEnabled);
    vscode.window.showInformationMessage(
      `shadcn/colors ${isEnabled ? "Disabled" : "Enabled"}`
    );
    this.updateDecorations();
  }

  private async handleColorChange(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active text editor");
      return;
    }

    const selection = editor.selection;

    if (selection.isEmpty) {
      vscode.window.showErrorMessage("No text selected");
      return;
    }

    const text = editor.document.getText(selection);

    try {
      const hslParts = text.trim().split(" ");
      if (hslParts.length !== 3) {
        vscode.window.showErrorMessage(
          "Selected text is not a valid HSL color"
        );
        return;
      }

      const newHexColor = await vscode.window.showInputBox({
        value: `#${colorConvert.hsl.hex([
          parseFloat(hslParts[0]),
          parseFloat(hslParts[1].replace("%", "")),
          parseFloat(hslParts[2].replace("%", "")),
        ])}`,

        prompt: "Color format should be (#rrggbb)",
        validateInput: (value) => {
          if (!value.startsWith("#")) {
            return "Color should start with #";
          }

          return validateColor.validateHTMLColorHex(value)
            ? null
            : "Invalid hex color!";
        },
      });

      if (!newHexColor) {
        return;
      }
      const [hue, saturation, lightness] = colorConvert.hex.hsl(newHexColor);

      const hslString = `${hue.toFixed(1)} ${saturation.toFixed(
        1
      )}% ${lightness.toFixed(1)}%`;

      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, hslString);
      });

      vscode.window.showInformationMessage(
        `Converted ${newHexColor} to HSL: ${hslString}`
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Error converting color: ${error.message}`
      );
    }
  }

  public dispose(): void {
    this.decorationType.dispose();
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const decorator = new ShadcnColors(context);
  context.subscriptions.push(decorator);
  context.globalState.update("shadcnColorsEnabled", true);
}

export function deactivate(): void {}
