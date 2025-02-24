import {
    addIcon, EventRef, Platform,
    Plugin, TFile
} from 'obsidian';
import {DEFAULT_SETTINGS, PlantUMLSettings, PlantUMLSettingsTab} from "./settings";
import {LocalProcessors} from "./localProcessors";
import {DebouncedProcessors} from "./debouncedProcessors";
import {isUsingLivePreviewEnabledEditor, LOGO_SVG} from "./const";
import {Processor} from "./processor";
import {ServerProcessor} from "./serverProcessor";
import {Replacer} from "./functions";
import {VIEW_TYPE} from "./PumlView";
import {Prec} from "@codemirror/state";
import {asyncDecoBuilderExt} from "./decorations/EmbedDecoration";

declare module "obsidian" {
    interface Workspace {
        on(
            name: "hover-link",
            callback: (e: MouseEvent) => any,
            ctx?: any,
        ): EventRef;
    }
}

export default class PlantumlPlugin extends Plugin {
    settings: PlantUMLSettings;

    serverProcessor: Processor;
    localProcessor: Processor;
    replacer: Replacer;

    observer: MutationObserver;

    public hover: {
        linkText: string;
        sourcePath: string;
    } = {
        linkText: null,
        sourcePath: null,
    };

    getProcessor(): Processor {
        if (Platform.isMobileApp) {
            return this.serverProcessor;
        }
        if (this.settings.localJar.length > 0) {
            return this.localProcessor;
        }
        return this.serverProcessor;
    }

    async onload(): Promise<void> {
        console.log('loading plugin plantuml');
        await this.loadSettings();
        this.addSettingTab(new PlantUMLSettingsTab(this));
        this.replacer = new Replacer(this);

        this.serverProcessor = new ServerProcessor(this);
        if (Platform.isDesktopApp) {
            this.localProcessor = new LocalProcessors(this);
        }

        const processor = new DebouncedProcessors(this);

        if (isUsingLivePreviewEnabledEditor()) {
            const view = require("./PumlView");
            addIcon("document-" + view.VIEW_TYPE, LOGO_SVG);
            this.registerView(view.VIEW_TYPE, (leaf) => {
                return new view.PumlView(leaf, this);
            });
            this.registerExtensions(["puml", "pu"], view.VIEW_TYPE);
            this.registerEditorExtension(Prec.lowest(asyncDecoBuilderExt(this)));
        }

        this.registerMarkdownCodeBlockProcessor("plantuml", processor.png);
        this.registerMarkdownCodeBlockProcessor("plantuml-ascii", processor.ascii);
        this.registerMarkdownCodeBlockProcessor("plantuml-svg", processor.svg);
        this.registerMarkdownCodeBlockProcessor("puml", processor.png);
        this.registerMarkdownCodeBlockProcessor("puml-svg", processor.svg);
        this.registerMarkdownCodeBlockProcessor("puml-ascii", processor.ascii);

        //keep this processor for backwards compatibility
        this.registerMarkdownCodeBlockProcessor("plantuml-map", processor.png);


        //internal links
        this.observer = new MutationObserver(async (mutation) => {
            if (mutation.length !== 1) return;
            if (mutation[0].addedNodes.length !== 1) return;
            if (this.hover.linkText === null) return;
            //@ts-ignore
            if (mutation[0].addedNodes[0].className !== "popover hover-popover file-embed is-loaded") return;

            const file = this.app.metadataCache.getFirstLinkpathDest(this.hover.linkText, this.hover.sourcePath);
            if (!file) return;
            if (file.extension !== "puml" && file.extension !== "pu") return;

            const fileContent = await this.app.vault.read(file);
            const imgDiv = createDiv();
            if(this.settings.defaultProcessor === "png") {
                await this.getProcessor().png(fileContent, imgDiv, null);
            }else {
                await this.getProcessor().svg(fileContent, imgDiv, null);
            }

            const node: Node = mutation[0].addedNodes[0];
            node.empty();

            const div = createDiv("", async (element) => {
                element.appendChild(imgDiv);
                element.setAttribute('src', file.path);
                element.onClickEvent((event => {
                    event.stopImmediatePropagation();
                    const leaf = this.app.workspace.getLeaf(event.ctrlKey);
                    leaf.setViewState({
                        type: VIEW_TYPE,
                        state: {file: file.path}
                    })
                }));
            });
            node.appendChild(div);

        });

        this.registerEvent(this.app.workspace.on("hover-link", async (event: any) => {
            const linkText: string = event.linktext;
            if (!linkText) return;
            const sourcePath: string = event.sourcePath;

            if (!linkText.endsWith(".puml") && !linkText.endsWith(".pu")) {
                return;
            }

            this.hover.linkText = linkText;
            this.hover.sourcePath = sourcePath;
        }));

        this.observer.observe(document, {childList: true, subtree: true});

        //embed handling
        this.registerMarkdownPostProcessor(async (element, context) => {
            const embeddedItems = element.querySelectorAll(".internal-embed");
            if (embeddedItems.length === 0) {
                return;
            }

            for (const key in embeddedItems) {
                const item = embeddedItems[key];
                if (typeof item.getAttribute !== "function") return;

                const filename = item.getAttribute("src");
                const file = this.app.metadataCache.getFirstLinkpathDest(filename.split("#")[0], context.sourcePath);
                if (file && file instanceof TFile && (file.extension === "puml" || file.extension === "pu")) {
                    const fileContent = await this.app.vault.read(file);

                    const div = createDiv();
                    if(this.settings.defaultProcessor === "png") {
                        await this.getProcessor().png(fileContent, div, context);
                    }else {
                        await this.getProcessor().svg(fileContent, div, context);
                    }

                    item.parentElement.replaceChild(div, item);
                }
            }

        });
    }


    async onunload(): Promise<void> {
        console.log('unloading plugin plantuml');
        this.observer.disconnect();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
