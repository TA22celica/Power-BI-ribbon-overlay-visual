"use strict";

import powerbi from "powerbi-visuals-api";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ITooltipService = powerbi.extensibility.ITooltipService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import * as d3 from "d3";

interface StackSegment {
    category: string;
    value: number;
    rank: number;
    y0: number;
    y1: number;
    color: string;
    selectionId: powerbi.visuals.ISelectionId;
}

interface PeriodData {
    period: string;
    total: number;
    dotSizeVal: number;
    rawDotLabel: string | number;
    segments: StackSegment[];
}

interface PanelData {
    name: string;
    periods: PeriodData[];
    maxTotal: number;
    maxDotVal: number;
    minDotVal: number;
    grandTotal: number;
}

interface NumberFormattingOptions {
    displayUnits: string;
    decimalPlaces: number;
    prefix: string;
    suffix: string;
}

interface VisualSettings {
    colorPaletteSettings: {
        palette: string;
    };
    legendSettings: {
        show: boolean;
        position: string;
        fontSize: number;
        fontColor: string;
    };
    smallMultiplesSettings: {
        columns: number;
        showTitle: boolean;
        titleFontSize: number;
        titleColor: string;
    };
    sortSettings: {
        categorySort: string;
        axisSort: string;
        smallMultiplesSort: string;
    };
    barSettings: {
        ribbonOpacity: number;
        columnPadding: number;
        showBarTotals: boolean;
        barTotalFontSize: number;
        barTotalColor: string;
        format: NumberFormattingOptions;
    };
    ribbonLabelSettings: {
        show: boolean;
        fontSize: number;
        fontColor: string;
        format: NumberFormattingOptions;
    };
    overlaySettings: {
        mode: string;
    };
    lineSettings: {
        lineColor: string;
        strokeWidth: number;
        lineStyle: string;
        curveType: string;
        useSecondaryAxis: boolean;
        showMarkers: boolean;
        markerShape: string;
        markerSize: number;
        markerColor: string;
        showLabels: boolean;
        labelPosition: string;
        labelFontSize: number;
        labelColor: string;
        format: NumberFormattingOptions;
    };
    dotSettings: {
        dotColor: string;
        maxDotRadius: number;
        dotOpacity: number;
        dotStrokeColor: string;
        dotStrokeWidth: number;
    };
    dotLabelSettings: {
        showDotTotals: boolean;
        labelPosition: string;
        labelFontSize: number;
        labelColor: string;
        format: NumberFormattingOptions;
    };
    yAxisSettings: {
        show: boolean;
        showTitle: boolean;
        titleFontSize: number;
        titleColor: string;
        scaleType: string;
        customMin: number | null;
        customMax: number | null;
        showGridlines: boolean;
        gridlineColor: string;
        fontSize: number;
        fontColor: string;
        format: NumberFormattingOptions;
    };
    secondaryYAxisSettings: {
        show: boolean;
        showTitle: boolean;
        titleFontSize: number;
        titleColor: string;
        scaleType: string;
        customMin: number | null;
        customMax: number | null;
        fontSize: number;
        fontColor: string;
        format: NumberFormattingOptions;
    };
    xAxisSettings: {
        show: boolean;
        labelRotation: string;
        fontSize: number;
        fontColor: string;
        showTitle: boolean;
        titleFontSize: number;
        titleColor: string;
    };
}

function cleanSymbol(sym: string): string {
    if (!sym || sym === "none") return "";
    return sym;
}

function formatNumber(
    val: number,
    units: string = "auto",
    decimals: number = -1,
    prefix: string = "none",
    suffix: string = "none"
): string {
    if (val === null || val === undefined || isNaN(val)) return "";

    let divisor = 1;
    let unitSuffix = "";
    const abs = Math.abs(val);

    if (units === "auto") {
        if (abs >= 1e12) { divisor = 1e12; unitSuffix = "T"; }
        else if (abs >= 1e9) { divisor = 1e9; unitSuffix = "B"; }
        else if (abs >= 1e6) { divisor = 1e6; unitSuffix = "M"; }
        else if (abs >= 1e3) { divisor = 1e3; unitSuffix = "K"; }
    } else if (units === "thousands") { divisor = 1e3; unitSuffix = "K"; }
    else if (units === "millions") { divisor = 1e6; unitSuffix = "M"; }
    else if (units === "billions") { divisor = 1e9; unitSuffix = "B"; }
    else if (units === "trillions") { divisor = 1e12; unitSuffix = "T"; }
    else if (units === "none") { divisor = 1; unitSuffix = ""; }

    const scaled = val / divisor;
    let formattedNumber: string;

    if (decimals >= 0) {
        formattedNumber = scaled.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    } else {
        formattedNumber = scaled.toLocaleString(undefined, {
            maximumFractionDigits: 2
        });
    }

    const pfx = cleanSymbol(prefix);
    const sfx = cleanSymbol(suffix);

    return `${pfx}${formattedNumber}${unitSuffix}${sfx}`;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private legendGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
    private mainGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
    private settings: VisualSettings;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.svg = d3.select(this.target).append("svg");
        this.legendGroup = this.svg.append("g").attr("class", "legend-container");
        this.mainGroup = this.svg.append("g").attr("class", "chart-grid-container");
        this.settings = this.getDefaultSettings();
    }

    private getDefaultSettings(): VisualSettings {
        return {
            colorPaletteSettings: {
                palette: "powerBi"
            },
            legendSettings: {
                show: true,
                position: "Top",
                fontSize: 10,
                fontColor: "#444444"
            },
            smallMultiplesSettings: {
                columns: 2,
                showTitle: true,
                titleFontSize: 12,
                titleColor: "#222222"
            },
            sortSettings: {
                categorySort: "rankDesc",
                axisSort: "natural",
                smallMultiplesSort: "natural"
            },
            barSettings: {
                ribbonOpacity: 45,
                columnPadding: 45,
                showBarTotals: true,
                barTotalFontSize: 10,
                barTotalColor: "#444444",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            ribbonLabelSettings: {
                show: false,
                fontSize: 9,
                fontColor: "#FFFFFF",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            overlaySettings: {
                mode: "dots"
            },
            lineSettings: {
                lineColor: "#FF5722",
                strokeWidth: 3,
                lineStyle: "solid",
                curveType: "smooth",
                useSecondaryAxis: true,
                showMarkers: true,
                markerShape: "circle",
                markerSize: 5,
                markerColor: "#FF5722",
                showLabels: false,
                labelPosition: "above",
                labelFontSize: 9,
                labelColor: "#333333",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            dotSettings: {
                dotColor: "#118DFF",
                maxDotRadius: 20,
                dotOpacity: 90,
                dotStrokeColor: "#FFFFFF",
                dotStrokeWidth: 2
            },
            dotLabelSettings: {
                showDotTotals: true,
                labelPosition: "inside",
                labelFontSize: 10,
                labelColor: "#FFFFFF",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            yAxisSettings: {
                show: true,
                showTitle: true,
                titleFontSize: 11,
                titleColor: "#444444",
                scaleType: "linear",
                customMin: null,
                customMax: null,
                showGridlines: true,
                gridlineColor: "#E0E0E0",
                fontSize: 10,
                fontColor: "#666666",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            secondaryYAxisSettings: {
                show: true,
                showTitle: true,
                titleFontSize: 11,
                titleColor: "#444444",
                scaleType: "linear",
                customMin: null,
                customMax: null,
                fontSize: 10,
                fontColor: "#666666",
                format: { displayUnits: "auto", decimalPlaces: -1, prefix: "none", suffix: "none" }
            },
            xAxisSettings: {
                show: true,
                labelRotation: "0",
                fontSize: 10,
                fontColor: "#666666",
                showTitle: true,
                titleFontSize: 11,
                titleColor: "#444444"
            }
        };
    }

    private parseSettings(dataView: powerbi.DataView): VisualSettings {
        const defaults = this.getDefaultSettings();
        const objects = dataView?.metadata?.objects;
        if (!objects) return defaults;

        const cp = objects["colorPaletteSettings"];
        const leg = objects["legendSettings"];
        const sm = objects["smallMultiplesSettings"];
        const srt = objects["sortSettings"];
        const bar = objects["barSettings"];
        const rLbl = objects["ribbonLabelSettings"];
        const ovr = objects["overlaySettings"];
        const line = objects["lineSettings"];
        const dot = objects["dotSettings"];
        const dotLabel = objects["dotLabelSettings"];
        const yAx = objects["yAxisSettings"];
        const sYAx = objects["secondaryYAxisSettings"];
        const xAx = objects["xAxisSettings"];

        return {
            colorPaletteSettings: {
                palette: String(cp?.["palette"] ?? defaults.colorPaletteSettings.palette)
            },
            legendSettings: {
                show: leg?.["show"] !== undefined ? Boolean(leg["show"]) : defaults.legendSettings.show,
                position: String(leg?.["position"] ?? defaults.legendSettings.position),
                fontSize: leg?.["fontSize"] !== undefined ? Number(leg["fontSize"]) : defaults.legendSettings.fontSize,
                fontColor: (leg?.["fontColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.legendSettings.fontColor
            },
            smallMultiplesSettings: {
                columns: sm?.["columns"] !== undefined ? Math.max(1, Number(sm["columns"])) : defaults.smallMultiplesSettings.columns,
                showTitle: sm?.["showTitle"] !== undefined ? Boolean(sm["showTitle"]) : defaults.smallMultiplesSettings.showTitle,
                titleFontSize: sm?.["titleFontSize"] !== undefined ? Number(sm["titleFontSize"]) : defaults.smallMultiplesSettings.titleFontSize,
                titleColor: (sm?.["titleColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.smallMultiplesSettings.titleColor
            },
            sortSettings: {
                categorySort: String(srt?.["categorySort"] ?? defaults.sortSettings.categorySort),
                axisSort: String(srt?.["axisSort"] ?? defaults.sortSettings.axisSort),
                smallMultiplesSort: String(srt?.["smallMultiplesSort"] ?? defaults.sortSettings.smallMultiplesSort)
            },
            barSettings: {
                ribbonOpacity: bar?.["ribbonOpacity"] !== undefined ? Number(bar["ribbonOpacity"]) : defaults.barSettings.ribbonOpacity,
                columnPadding: bar?.["columnPadding"] !== undefined ? Number(bar["columnPadding"]) : defaults.barSettings.columnPadding,
                showBarTotals: bar?.["showBarTotals"] !== undefined ? Boolean(bar["showBarTotals"]) : defaults.barSettings.showBarTotals,
                barTotalFontSize: bar?.["barTotalFontSize"] !== undefined ? Number(bar["barTotalFontSize"]) : defaults.barSettings.barTotalFontSize,
                barTotalColor: (bar?.["barTotalColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.barSettings.barTotalColor,
                format: {
                    displayUnits: String(bar?.["displayUnits"] ?? "auto"),
                    decimalPlaces: bar?.["decimalPlaces"] !== undefined && bar["decimalPlaces"] !== null ? Number(bar["decimalPlaces"]) : -1,
                    prefix: String(bar?.["prefix"] ?? "none"),
                    suffix: String(bar?.["suffix"] ?? "none")
                }
            },
            ribbonLabelSettings: {
                show: rLbl?.["show"] !== undefined ? Boolean(rLbl["show"]) : defaults.ribbonLabelSettings.show,
                fontSize: rLbl?.["fontSize"] !== undefined ? Number(rLbl["fontSize"]) : defaults.ribbonLabelSettings.fontSize,
                fontColor: (rLbl?.["fontColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.ribbonLabelSettings.fontColor,
                format: {
                    displayUnits: String(rLbl?.["displayUnits"] ?? "auto"),
                    decimalPlaces: rLbl?.["decimalPlaces"] !== undefined && rLbl["decimalPlaces"] !== null ? Number(rLbl["decimalPlaces"]) : -1,
                    prefix: String(rLbl?.["prefix"] ?? "none"),
                    suffix: String(rLbl?.["suffix"] ?? "none")
                }
            },
            overlaySettings: {
                mode: String(ovr?.["mode"] ?? defaults.overlaySettings.mode)
            },
            lineSettings: {
                lineColor: (line?.["lineColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.lineSettings.lineColor,
                strokeWidth: line?.["strokeWidth"] !== undefined ? Number(line["strokeWidth"]) : defaults.lineSettings.strokeWidth,
                lineStyle: String(line?.["lineStyle"] ?? defaults.lineSettings.lineStyle),
                curveType: String(line?.["curveType"] ?? defaults.lineSettings.curveType),
                useSecondaryAxis: line?.["useSecondaryAxis"] !== undefined ? Boolean(line["useSecondaryAxis"]) : defaults.lineSettings.useSecondaryAxis,
                showMarkers: line?.["showMarkers"] !== undefined ? Boolean(line["showMarkers"]) : defaults.lineSettings.showMarkers,
                markerShape: String(line?.["markerShape"] ?? defaults.lineSettings.markerShape),
                markerSize: line?.["markerSize"] !== undefined ? Number(line["markerSize"]) : defaults.lineSettings.markerSize,
                markerColor: (line?.["markerColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.lineSettings.markerColor,
                showLabels: line?.["showLabels"] !== undefined ? Boolean(line["showLabels"]) : defaults.lineSettings.showLabels,
                labelPosition: String(line?.["labelPosition"] ?? defaults.lineSettings.labelPosition),
                labelFontSize: line?.["labelFontSize"] !== undefined ? Number(line["labelFontSize"]) : defaults.lineSettings.labelFontSize,
                labelColor: (line?.["labelColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.lineSettings.labelColor,
                format: {
                    displayUnits: String(line?.["displayUnits"] ?? "auto"),
                    decimalPlaces: line?.["decimalPlaces"] !== undefined && line["decimalPlaces"] !== null ? Number(line["decimalPlaces"]) : -1,
                    prefix: String(line?.["prefix"] ?? "none"),
                    suffix: String(line?.["suffix"] ?? "none")
                }
            },
            dotSettings: {
                dotColor: (dot?.["dotColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.dotSettings.dotColor,
                maxDotRadius: dot?.["maxDotRadius"] !== undefined ? Number(dot["maxDotRadius"]) : defaults.dotSettings.maxDotRadius,
                dotOpacity: dot?.["dotOpacity"] !== undefined ? Number(dot["dotOpacity"]) : defaults.dotSettings.dotOpacity,
                dotStrokeColor: (dot?.["dotStrokeColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.dotSettings.dotStrokeColor,
                dotStrokeWidth: dot?.["dotStrokeWidth"] !== undefined ? Number(dot["dotStrokeWidth"]) : defaults.dotSettings.dotStrokeWidth
            },
            dotLabelSettings: {
                showDotTotals: dotLabel?.["showDotTotals"] !== undefined ? Boolean(dotLabel["showDotTotals"]) : defaults.dotLabelSettings.showDotTotals,
                labelPosition: String(dotLabel?.["labelPosition"] ?? defaults.dotLabelSettings.labelPosition),
                labelFontSize: dotLabel?.["labelFontSize"] !== undefined ? Number(dotLabel["labelFontSize"]) : defaults.dotLabelSettings.labelFontSize,
                labelColor: (dotLabel?.["labelColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.dotLabelSettings.labelColor,
                format: {
                    displayUnits: String(dotLabel?.["displayUnits"] ?? "auto"),
                    decimalPlaces: dotLabel?.["decimalPlaces"] !== undefined && dotLabel["decimalPlaces"] !== null ? Number(dotLabel["decimalPlaces"]) : -1,
                    prefix: String(dotLabel?.["prefix"] ?? "none"),
                    suffix: String(dotLabel?.["suffix"] ?? "none")
                }
            },
            yAxisSettings: {
                show: yAx?.["show"] !== undefined ? Boolean(yAx["show"]) : defaults.yAxisSettings.show,
                showTitle: yAx?.["showTitle"] !== undefined ? Boolean(yAx["showTitle"]) : defaults.yAxisSettings.showTitle,
                titleFontSize: yAx?.["titleFontSize"] !== undefined ? Number(yAx["titleFontSize"]) : defaults.yAxisSettings.titleFontSize,
                titleColor: (yAx?.["titleColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.yAxisSettings.titleColor,
                scaleType: String(yAx?.["scaleType"] ?? defaults.yAxisSettings.scaleType),
                customMin: yAx?.["customMin"] !== undefined ? Number(yAx["customMin"]) : null,
                customMax: yAx?.["customMax"] !== undefined ? Number(yAx["customMax"]) : null,
                showGridlines: yAx?.["showGridlines"] !== undefined ? Boolean(yAx["showGridlines"]) : defaults.yAxisSettings.showGridlines,
                gridlineColor: (yAx?.["gridlineColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.yAxisSettings.gridlineColor,
                fontSize: yAx?.["fontSize"] !== undefined ? Number(yAx["fontSize"]) : defaults.yAxisSettings.fontSize,
                fontColor: (yAx?.["fontColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.yAxisSettings.fontColor,
                format: {
                    displayUnits: String(yAx?.["displayUnits"] ?? "auto"),
                    decimalPlaces: yAx?.["decimalPlaces"] !== undefined && yAx["decimalPlaces"] !== null ? Number(yAx["decimalPlaces"]) : -1,
                    prefix: "none",
                    suffix: "none"
                }
            },
            secondaryYAxisSettings: {
                show: sYAx?.["show"] !== undefined ? Boolean(sYAx["show"]) : defaults.secondaryYAxisSettings.show,
                showTitle: sYAx?.["showTitle"] !== undefined ? Boolean(sYAx["showTitle"]) : defaults.secondaryYAxisSettings.showTitle,
                titleFontSize: sYAx?.["titleFontSize"] !== undefined ? Number(sYAx["titleFontSize"]) : defaults.secondaryYAxisSettings.titleFontSize,
                titleColor: (sYAx?.["titleColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.secondaryYAxisSettings.titleColor,
                scaleType: String(sYAx?.["scaleType"] ?? defaults.secondaryYAxisSettings.scaleType),
                customMin: sYAx?.["customMin"] !== undefined ? Number(sYAx["customMin"]) : null,
                customMax: sYAx?.["customMax"] !== undefined ? Number(sYAx["customMax"]) : null,
                fontSize: sYAx?.["fontSize"] !== undefined ? Number(sYAx["fontSize"]) : defaults.secondaryYAxisSettings.fontSize,
                fontColor: (sYAx?.["fontColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.secondaryYAxisSettings.fontColor,
                format: {
                    displayUnits: String(sYAx?.["displayUnits"] ?? "auto"),
                    decimalPlaces: sYAx?.["decimalPlaces"] !== undefined && sYAx["decimalPlaces"] !== null ? Number(sYAx["decimalPlaces"]) : -1,
                    prefix: "none",
                    suffix: "none"
                }
            },
            xAxisSettings: {
                show: xAx?.["show"] !== undefined ? Boolean(xAx["show"]) : defaults.xAxisSettings.show,
                labelRotation: String(xAx?.["labelRotation"] ?? defaults.xAxisSettings.labelRotation),
                fontSize: xAx?.["fontSize"] !== undefined ? Number(xAx["fontSize"]) : defaults.xAxisSettings.fontSize,
                fontColor: (xAx?.["fontColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.xAxisSettings.fontColor,
                showTitle: xAx?.["showTitle"] !== undefined ? Boolean(xAx["showTitle"]) : defaults.xAxisSettings.showTitle,
                titleFontSize: xAx?.["titleFontSize"] !== undefined ? Number(xAx["titleFontSize"]) : defaults.xAxisSettings.titleFontSize,
                titleColor: (xAx?.["titleColor"] as { solid?: { color?: string } })?.solid?.color ?? defaults.xAxisSettings.titleColor
            }
        };
    }

    private getColorScale(categories: string[]): (cat: string) => string {
        const pal = this.settings.colorPaletteSettings.palette;
        if (pal === "powerBi") {
            const map = new Map<string, string>();
            categories.forEach(cat => {
                map.set(cat, this.host.colorPalette.getColor(cat).value);
            });
            return (cat: string) => map.get(cat) || "#118DFF";
        }

        let scheme: readonly string[] = d3.schemeTableau10;
        if (pal === "category10") scheme = d3.schemeCategory10;
        else if (pal === "paired") scheme = d3.schemePaired;
        else if (pal === "accent") scheme = d3.schemeAccent;
        else if (pal === "dark2") scheme = d3.schemeDark2;
        else if (pal === "set2") scheme = d3.schemeSet2;

        const scale = d3.scaleOrdinal(scheme).domain(categories);
        return (cat: string) => scale(cat);
    }

    public update(options: VisualUpdateOptions) {
        this.legendGroup.selectAll("*").remove();
        this.mainGroup.selectAll("*").remove();

        const dataView = options.dataViews && options.dataViews[0];
        if (!dataView || !dataView.categorical) return;

        this.settings = this.parseSettings(dataView);

        const totalWidth = options.viewport.width;
        const totalHeight = options.viewport.height;
        this.svg.attr("width", totalWidth).attr("height", totalHeight);

        this.svg.on("click", () => {
            this.selectionManager.clear();
            this.svg.selectAll(".ribbon-element, .bar-element, .dot-element").attr("opacity", 1);
        });

        const categories = dataView.categorical.categories || [];
        const values = dataView.categorical.values || [];
        if (categories.length < 2 || !values.length) return;

        const axisCat = categories.find(c => c.source.roles && c.source.roles["axis"]) || categories[0];
        const ribbonCat = categories.find(c => c.source.roles && c.source.roles["category"]) || categories[1];
        const smallMultCat = categories.find(c => c.source.roles && c.source.roles["smallMultiples"]);

        const ribbonValCol = values.find(v => v.source.roles && v.source.roles["ribbonValue"]) || values[0];
        const dotSizeCol = values.find(v => v.source.roles && v.source.roles["dotSize"]) || values[1];
        const dotLabelCol = values.find(v => v.source.roles && v.source.roles["dotLabel"]) || values[2];

        const rowCount = axisCat.values.length;
        const rawAxisVals = axisCat.values.map(v => String(v ?? ""));
        const rawCatVals = ribbonCat.values.map(v => String(v ?? ""));
        const rawSmVals = smallMultCat ? smallMultCat.values.map(v => String(v ?? "")) : new Array(rowCount).fill("All");

        const ribbonVals = (ribbonValCol?.values || []).map(v => Number(v) || 0);
        const dotSizeVals = (dotSizeCol?.values || []).map(v => Number(v) || 0);
        const dotLabelVals = dotLabelCol?.values || [];

        let uniquePeriods = Array.from(new Set(rawAxisVals));
        if (this.settings.sortSettings.axisSort === "asc") {
            uniquePeriods.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        } else if (this.settings.sortSettings.axisSort === "desc") {
            uniquePeriods.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        }

        const uniqueCategories = Array.from(new Set(rawCatVals));
        const colorScale = this.getColorScale(uniqueCategories);

        let legendOffset = { top: 0, bottom: 0, left: 0, right: 0 };
        if (this.settings.legendSettings.show && uniqueCategories.length > 0) {
            legendOffset = this.renderLegend(uniqueCategories, colorScale, totalWidth, totalHeight);
        }

        const gridX = legendOffset.left;
        const gridY = legendOffset.top;
        const gridWidth = Math.max(0, totalWidth - legendOffset.left - legendOffset.right);
        const gridHeight = Math.max(0, totalHeight - legendOffset.top - legendOffset.bottom);

        const panelMap = new Map<string, Map<string, PeriodData>>();
        for (let i = 0; i < rowCount; i++) {
            const sm = rawSmVals[i];
            const p = rawAxisVals[i];
            const cat = rawCatVals[i];
            const val = ribbonVals[i] || 0;
            const dSize = dotSizeVals[i] || 0;
            const rawLabel = dotLabelVals[i] != null ? (dotLabelVals[i] as string | number) : dSize;

            if (!panelMap.has(sm)) {
                panelMap.set(sm, new Map<string, PeriodData>());
            }
            const periodMap = panelMap.get(sm)!;
            if (!periodMap.has(p)) {
                periodMap.set(p, { period: p, total: 0, dotSizeVal: 0, rawDotLabel: "", segments: [] });
            }

            const pData = periodMap.get(p)!;
            const selectionId = this.host.createSelectionIdBuilder()
                .withCategory(ribbonCat, i)
                .withCategory(axisCat, i)
                .createSelectionId();

            pData.segments.push({
                category: cat,
                value: val,
                rank: 0,
                y0: 0,
                y1: 0,
                color: colorScale(cat),
                selectionId
            });

            if (dSize > 0) pData.dotSizeVal += dSize;
            if (rawLabel !== undefined && rawLabel !== null) pData.rawDotLabel = rawLabel;
        }

        const panels: PanelData[] = [];
        const uniqueSmNames = Array.from(new Set(rawSmVals));

        uniqueSmNames.forEach(smName => {
            const pMap = panelMap.get(smName);
            if (!pMap) return;

            const periodList: PeriodData[] = uniquePeriods.map(pName => {
                return pMap.get(pName) || { period: pName, total: 0, dotSizeVal: 0, rawDotLabel: "", segments: [] };
            });

            let maxTotal = 0;
            let maxDotVal = 0;
            let minDotVal = Infinity;
            let grandTotal = 0;

            periodList.forEach(d => {
                if (this.settings.sortSettings.categorySort === "alphabetical") {
                    d.segments.sort((a, b) => a.category.localeCompare(b.category));
                } else if (this.settings.sortSettings.categorySort === "rankAsc") {
                    d.segments.sort((a, b) => a.value - b.value);
                } else {
                    d.segments.sort((a, b) => b.value - a.value);
                }

                let sum = 0;
                d.segments.forEach((seg, idx) => {
                    seg.rank = idx + 1;
                    sum += seg.value;
                });
                d.total = sum;
                grandTotal += sum;

                let acc = 0;
                for (let j = d.segments.length - 1; j >= 0; j--) {
                    const seg = d.segments[j];
                    seg.y0 = acc;
                    acc += seg.value;
                    seg.y1 = acc;
                }

                if (d.total > maxTotal) maxTotal = d.total;
                if (d.dotSizeVal > maxDotVal) maxDotVal = d.dotSizeVal;
                if (d.dotSizeVal < minDotVal && d.dotSizeVal > 0) minDotVal = d.dotSizeVal;
            });

            if (minDotVal === Infinity) minDotVal = 0;
            panels.push({ name: smName, periods: periodList, maxTotal, maxDotVal, minDotVal, grandTotal });
        });

        const smSort = this.settings.sortSettings.smallMultiplesSort;
        if (smSort === "asc") {
            panels.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        } else if (smSort === "desc") {
            panels.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
        } else if (smSort === "totalDesc") {
            panels.sort((a, b) => b.grandTotal - a.grandTotal);
        } else if (smSort === "totalAsc") {
            panels.sort((a, b) => a.grandTotal - b.grandTotal);
        }

        const numCols = Math.min(this.settings.smallMultiplesSettings.columns, panels.length);
        const numRows = Math.ceil(panels.length / numCols);
        const cellWidth = gridWidth / numCols;
        const cellHeight = gridHeight / numRows;

        const axisTitle = axisCat.source.displayName || "Period";
        const primaryYTitle = ribbonValCol?.source?.displayName || "Value";
        const secondaryYTitle = dotSizeCol?.source?.displayName || "Line Value";

        panels.forEach((panel, idx) => {
            const colIndex = idx % numCols;
            const rowIndex = Math.floor(idx / numCols);
            const posX = gridX + colIndex * cellWidth;
            const posY = gridY + rowIndex * cellHeight;

            const panelGroup = this.mainGroup.append("g")
                .attr("transform", `translate(${posX},${posY})`);

            this.renderPanel(panel, panelGroup, cellWidth, cellHeight, uniquePeriods, smallMultCat != null, axisTitle, primaryYTitle, secondaryYTitle);
        });
    }

    private renderLegend(categories: string[], colorScale: (cat: string) => string, totalWidth: number, totalHeight: number) {
        const pos = this.settings.legendSettings.position;
        const fontSize = this.settings.legendSettings.fontSize;
        const fontColor = this.settings.legendSettings.fontColor;

        let top = 10, bottom = 10, left = 10, right = 10;
        const isHorizontal = pos === "Top" || pos === "Bottom";

        if (pos === "Top") top = 38;
        if (pos === "Bottom") bottom = 38;
        if (pos === "Left") left = 120;
        if (pos === "Right") right = 120;

        const startX = pos === "Right" ? totalWidth - 110 : 20;
        const startY = pos === "Bottom" ? totalHeight - 25 : 20;

        const legItems = this.legendGroup.selectAll(".legend-item")
            .data(categories)
            .enter()
            .append("g")
            .attr("class", "legend-item")
            .attr("cursor", "pointer")
            .on("click", (event: MouseEvent, d: string) => {
                event.stopPropagation();
                this.svg.selectAll(".ribbon-element, .bar-element").each(function () {
                    const el = d3.select(this);
                    const cat = el.attr("data-cat");
                    el.attr("opacity", cat === d ? 1 : 0.15);
                });
            });

        if (isHorizontal) {
            let runningX = 20;
            legItems.each(function (cat) {
                const item = d3.select(this);
                item.attr("transform", `translate(${runningX}, ${startY})`);
                item.append("circle").attr("r", 5).attr("fill", colorScale(cat));
                const txt = item.append("text")
                    .attr("x", 10)
                    .attr("y", 4)
                    .attr("font-size", `${fontSize}px`)
                    .attr("fill", fontColor)
                    .text(cat);
                const node = txt.node() as SVGGraphicsElement;
                const textWidth = node ? node.getBBox().width : 40;
                runningX += textWidth + 25;
            });
        } else {
            legItems.attr("transform", (d, i) => `translate(${startX}, ${startY + i * (fontSize + 10)})`);
            legItems.append("circle").attr("r", 5).attr("fill", d => colorScale(d));
            legItems.append("text")
                .attr("x", 10)
                .attr("y", 4)
                .attr("font-size", `${fontSize}px`)
                .attr("fill", fontColor)
                .text(d => d);
        }

        return { top, bottom, left, right };
    }

    private renderPanel(
        panel: PanelData,
        group: d3.Selection<SVGGElement, unknown, null, undefined>,
        width: number,
        height: number,
        periods: string[],
        hasSmallMultiples: boolean,
        axisTitle: string,
        primaryYTitle: string,
        secondaryYTitle: string
    ) {
        const titlePadding = (hasSmallMultiples && this.settings.smallMultiplesSettings.showTitle) ? 26 : 0;
        const showSecondaryAxis = (this.settings.overlaySettings.mode === "line" || this.settings.overlaySettings.mode === "both") &&
            this.settings.lineSettings.useSecondaryAxis &&
            this.settings.secondaryYAxisSettings.show;

        const rotation = Number(this.settings.xAxisSettings.labelRotation) || 0;
        const isRotated = rotation !== 0;

        let extraBottom = 15;
        if (this.settings.xAxisSettings.show) {
            extraBottom = isRotated ? (Math.abs(rotation) === 90 ? 60 : 48) : 32;
            if (this.settings.xAxisSettings.showTitle) {
                extraBottom += this.settings.xAxisSettings.titleFontSize + 12;
            }
        }

        let extraLeft = 15;
        if (this.settings.yAxisSettings.show) {
            extraLeft = 45;
            if (this.settings.yAxisSettings.showTitle) {
                extraLeft += this.settings.yAxisSettings.titleFontSize + 14;
            }
        }

        let extraRight = 15;
        if (showSecondaryAxis) {
            extraRight = 45;
            if (this.settings.secondaryYAxisSettings.showTitle) {
                extraRight += this.settings.secondaryYAxisSettings.titleFontSize + 14;
            }
        }

        const margin = {
            top: 25 + titlePadding,
            right: extraRight,
            bottom: extraBottom,
            left: extraLeft
        };

        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);

        if (hasSmallMultiples && this.settings.smallMultiplesSettings.showTitle) {
            group.append("text")
                .attr("x", width / 2)
                .attr("y", 18)
                .attr("text-anchor", "middle")
                .attr("font-size", `${this.settings.smallMultiplesSettings.titleFontSize}px`)
                .attr("font-weight", "bold")
                .attr("fill", this.settings.smallMultiplesSettings.titleColor)
                .text(panel.name);
        }

        const plotGroup = group.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const yMin = this.settings.yAxisSettings.customMin ?? 0;
        const yMax = this.settings.yAxisSettings.customMax ?? (panel.maxTotal > 0 ? panel.maxTotal * 1.15 : 100);

        let yScale: d3.ScaleContinuousNumeric<number, number>;
        if (this.settings.yAxisSettings.scaleType === "log") {
            yScale = d3.scaleSymlog().domain([yMin, yMax]).range([innerHeight, 0]);
        } else {
            yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerHeight, 0]);
        }

        const secMin = this.settings.secondaryYAxisSettings.customMin ?? (panel.minDotVal > 0 ? panel.minDotVal * 0.85 : 0);
        const secMax = this.settings.secondaryYAxisSettings.customMax ?? (panel.maxDotVal > 0 ? panel.maxDotVal * 1.15 : 100);

        let ySecondaryScale: d3.ScaleContinuousNumeric<number, number>;
        if (this.settings.secondaryYAxisSettings.scaleType === "log") {
            ySecondaryScale = d3.scaleSymlog().domain([secMin, secMax]).range([innerHeight, 0]);
        } else {
            ySecondaryScale = d3.scaleLinear().domain([secMin, secMax]).range([innerHeight, 0]);
        }

        const lineYScale = (this.settings.lineSettings.useSecondaryAxis && showSecondaryAxis) ? ySecondaryScale : yScale;

        const paddingRatio = Math.min(0.85, Math.max(0.1, this.settings.barSettings.columnPadding / 100));
        const xScale = d3.scaleBand().domain(periods).range([0, innerWidth]).padding(paddingRatio);
        const dotRadiusScale = d3.scaleSqrt().domain([0, panel.maxDotVal || 1]).range([4, this.settings.dotSettings.maxDotRadius]);

        const barWidth = xScale.bandwidth();
        const ribbonBaseOpacity = this.settings.barSettings.ribbonOpacity / 100;

        if (this.settings.yAxisSettings.showGridlines) {
            const gridAxis = d3.axisLeft(yScale).ticks(4).tickSize(-innerWidth).tickFormat(() => "");
            plotGroup.append("g")
                .attr("class", "grid")
                .call(gridAxis)
                .selectAll("line")
                .attr("stroke", this.settings.yAxisSettings.gridlineColor)
                .attr("stroke-dasharray", "2,2");
        }

        const ribbonGroup = plotGroup.append("g").attr("class", "ribbons");
        for (let i = 0; i < panel.periods.length - 1; i++) {
            const curr = panel.periods[i];
            const next = panel.periods[i + 1];

            const x0 = (xScale(curr.period) || 0) + barWidth;
            const x1 = xScale(next.period) || 0;
            const xi = d3.interpolateNumber(x0, x1);
            const xmid0 = xi(0.5);
            const xmid1 = xi(0.5);

            curr.segments.forEach(segCurr => {
                const segNext = next.segments.find(s => s.category === segCurr.category);
                if (segNext) {
                    const y0_curr = yScale(segCurr.y0);
                    const y1_curr = yScale(segCurr.y1);
                    const y0_next = yScale(segNext.y0);
                    const y1_next = yScale(segNext.y1);

                    const ribbonPath = `
                        M ${x0} ${y1_curr}
                        C ${xmid0} ${y1_curr}, ${xmid1} ${y1_next}, ${x1} ${y1_next}
                        L ${x1} ${y0_next}
                        C ${xmid1} ${y0_next}, ${xmid0} ${y0_curr}, ${x0} ${y0_curr}
                        Z
                    `;

                    const pathElement = ribbonGroup.append("path")
                        .attr("class", "ribbon-element")
                        .attr("data-cat", segCurr.category)
                        .attr("d", ribbonPath)
                        .attr("fill", segCurr.color)
                        .attr("fill-opacity", ribbonBaseOpacity)
                        .attr("cursor", "pointer");

                    const diff = segNext.value - segCurr.value;
                    const diffPct = segCurr.value !== 0 ? ((diff / segCurr.value) * 100).toFixed(1) + "%" : "N/A";
                    const bFmt = this.settings.barSettings.format;

                    const ribbonTooltip: VisualTooltipDataItem[] = [
                        { displayName: "Category", value: segCurr.category },
                        { displayName: `${curr.period} (Rank #${segCurr.rank})`, value: formatNumber(segCurr.value, bFmt.displayUnits, bFmt.decimalPlaces, bFmt.prefix, bFmt.suffix) },
                        { displayName: `${next.period} (Rank #${segNext.rank})`, value: formatNumber(segNext.value, bFmt.displayUnits, bFmt.decimalPlaces, bFmt.prefix, bFmt.suffix) },
                        { displayName: "Change", value: `${diff >= 0 ? "+" : ""}${formatNumber(diff, bFmt.displayUnits, bFmt.decimalPlaces, bFmt.prefix, bFmt.suffix)} (${diffPct})` }
                    ];

                    pathElement
                        .on("mouseover", (event: MouseEvent) => {
                            pathElement.attr("fill-opacity", Math.min(1, ribbonBaseOpacity + 0.35));
                            this.tooltipService.show({
                                coordinates: [event.clientX, event.clientY],
                                isTouchEvent: false,
                                dataItems: ribbonTooltip,
                                identities: []
                            });
                        })
                        .on("mousemove", (event: MouseEvent) => {
                            this.tooltipService.move({
                                coordinates: [event.clientX, event.clientY],
                                isTouchEvent: false,
                                dataItems: ribbonTooltip,
                                identities: []
                            });
                        })
                        .on("mouseout", () => {
                            pathElement.attr("fill-opacity", ribbonBaseOpacity);
                            this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                        })
                        .on("click", (event: MouseEvent) => {
                            event.stopPropagation();
                            this.selectionManager.select(segCurr.selectionId, event.ctrlKey || event.metaKey);
                        });
                }
            });
        }

        const barGroup = plotGroup.append("g").attr("class", "columns");
        panel.periods.forEach(d => {
            const xPos = xScale(d.period) || 0;
            const bFmt = this.settings.barSettings.format;
            const rLblFmt = this.settings.ribbonLabelSettings.format;

            d.segments.forEach(seg => {
                const segTop = yScale(seg.y1);
                const segHeight = Math.max(0, yScale(seg.y0) - segTop);

                const rect = barGroup.append("rect")
                    .attr("class", "bar-element")
                    .attr("data-cat", seg.category)
                    .attr("x", xPos)
                    .attr("y", segTop)
                    .attr("width", barWidth)
                    .attr("height", segHeight)
                    .attr("fill", seg.color)
                    .attr("cursor", "pointer");

                const barTooltip: VisualTooltipDataItem[] = [
                    { displayName: "Period", value: d.period },
                    { displayName: "Category", value: seg.category },
                    { displayName: "Rank", value: `#${seg.rank}` },
                    { displayName: "Value", value: formatNumber(seg.value, bFmt.displayUnits, bFmt.decimalPlaces, bFmt.prefix, bFmt.suffix) },
                    { displayName: "% of Period Total", value: `${((seg.value / (d.total || 1)) * 100).toFixed(1)}%` }
                ];

                rect
                    .on("mouseover", (event: MouseEvent) => {
                        rect.attr("stroke", "#222222").attr("stroke-width", 1.5);
                        this.tooltipService.show({
                            coordinates: [event.clientX, event.clientY],
                            isTouchEvent: false,
                            dataItems: barTooltip,
                            identities: []
                        });
                    })
                    .on("mousemove", (event: MouseEvent) => {
                        this.tooltipService.move({
                            coordinates: [event.clientX, event.clientY],
                            isTouchEvent: false,
                            dataItems: barTooltip,
                            identities: []
                        });
                    })
                    .on("mouseout", () => {
                        rect.attr("stroke", "none");
                        this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                    })
                    .on("click", (event: MouseEvent) => {
                        event.stopPropagation();
                        this.selectionManager.select(seg.selectionId, event.ctrlKey || event.metaKey);
                    });

                if (this.settings.ribbonLabelSettings.show && segHeight > this.settings.ribbonLabelSettings.fontSize + 4) {
                    const formattedSegVal = formatNumber(seg.value, rLblFmt.displayUnits, rLblFmt.decimalPlaces, rLblFmt.prefix, rLblFmt.suffix);
                    barGroup.append("text")
                        .attr("x", xPos + barWidth / 2)
                        .attr("y", segTop + segHeight / 2 + (this.settings.ribbonLabelSettings.fontSize / 3))
                        .attr("text-anchor", "middle")
                        .attr("font-size", `${this.settings.ribbonLabelSettings.fontSize}px`)
                        .attr("font-weight", "600")
                        .attr("fill", this.settings.ribbonLabelSettings.fontColor)
                        .attr("pointer-events", "none")
                        .text(formattedSegVal);
                }
            });

            if (this.settings.barSettings.showBarTotals && d.total > 0) {
                const formattedBarTotal = formatNumber(d.total, bFmt.displayUnits, bFmt.decimalPlaces, bFmt.prefix, bFmt.suffix);

                plotGroup.append("text")
                    .attr("x", xPos + barWidth / 2)
                    .attr("y", yScale(d.total) - 6)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${this.settings.barSettings.barTotalFontSize}px`)
                    .attr("font-weight", "600")
                    .attr("fill", this.settings.barSettings.barTotalColor)
                    .text(formattedBarTotal);
            }
        });

        const mode = this.settings.overlaySettings.mode;
        if (mode === "dots" || mode === "both") {
            const dFmt = this.settings.dotLabelSettings.format;
            panel.periods.forEach(d => {
                if (d.dotSizeVal > 0) {
                    const xPos = xScale(d.period) || 0;
                    const r = dotRadiusScale(d.dotSizeVal);
                    const dotCenterX = xPos + barWidth / 2;
                    const dotCenterY = yScale(d.total / 2);
                    const dotOpacity = this.settings.dotSettings.dotOpacity / 100;

                    const circle = plotGroup.append("circle")
                        .attr("class", "dot-element")
                        .attr("cx", dotCenterX)
                        .attr("cy", dotCenterY)
                        .attr("r", r)
                        .attr("fill", this.settings.dotSettings.dotColor)
                        .attr("fill-opacity", dotOpacity)
                        .attr("stroke", this.settings.dotSettings.dotStrokeColor)
                        .attr("stroke-width", this.settings.dotSettings.dotStrokeWidth)
                        .attr("cursor", "pointer");

                    let dotLabelDisplay = "";
                    if (typeof d.rawDotLabel === "number") {
                        dotLabelDisplay = formatNumber(d.rawDotLabel, dFmt.displayUnits, dFmt.decimalPlaces, dFmt.prefix, dFmt.suffix);
                    } else if (!isNaN(Number(d.rawDotLabel)) && d.rawDotLabel !== "") {
                        dotLabelDisplay = formatNumber(Number(d.rawDotLabel), dFmt.displayUnits, dFmt.decimalPlaces, dFmt.prefix, dFmt.suffix);
                    } else {
                        dotLabelDisplay = String(d.rawDotLabel || "");
                    }

                    const dotTooltip: VisualTooltipDataItem[] = [
                        { displayName: "Period", value: d.period },
                        { displayName: "Dot Metric", value: formatNumber(d.dotSizeVal, dFmt.displayUnits, dFmt.decimalPlaces, dFmt.prefix, dFmt.suffix) },
                        ...(dotLabelDisplay ? [{ displayName: "Callout Value", value: dotLabelDisplay }] : []),
                        { displayName: "Column Total", value: formatNumber(d.total, this.settings.barSettings.format.displayUnits, this.settings.barSettings.format.decimalPlaces, this.settings.barSettings.format.prefix, this.settings.barSettings.format.suffix) }
                    ];

                    circle
                        .on("mouseover", (event: MouseEvent) => {
                            circle.attr("r", r + 2).attr("fill-opacity", 1);
                            this.tooltipService.show({
                                coordinates: [event.clientX, event.clientY],
                                isTouchEvent: false,
                                dataItems: dotTooltip,
                                identities: []
                            });
                        })
                        .on("mousemove", (event: MouseEvent) => {
                            this.tooltipService.move({
                                coordinates: [event.clientX, event.clientY],
                                isTouchEvent: false,
                                dataItems: dotTooltip,
                                identities: []
                            });
                        })
                        .on("mouseout", () => {
                            circle.attr("r", r).attr("fill-opacity", dotOpacity);
                            this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                        });

                    if (this.settings.dotLabelSettings.showDotTotals && dotLabelDisplay) {
                        const isInside = this.settings.dotLabelSettings.labelPosition === "inside";
                        const textY = isInside ? dotCenterY + 4 : dotCenterY - r - 5;
                        const calculatedFontSize = isInside
                            ? Math.min(this.settings.dotLabelSettings.labelFontSize, Math.max(8, r * 0.75))
                            : this.settings.dotLabelSettings.labelFontSize;

                        plotGroup.append("text")
                            .attr("x", dotCenterX)
                            .attr("y", textY)
                            .attr("text-anchor", "middle")
                            .attr("font-size", `${calculatedFontSize}px`)
                            .attr("font-weight", "bold")
                            .attr("fill", this.settings.dotLabelSettings.labelColor)
                            .attr("pointer-events", "none")
                            .text(dotLabelDisplay);
                    }
                }
            });
        }

        if (mode === "line" || mode === "both") {
            const linePoints = panel.periods.filter(p => p.dotSizeVal !== 0 && !isNaN(p.dotSizeVal));
            const lSettings = this.settings.lineSettings;
            const lFmt = lSettings.format;

            if (linePoints.length > 0) {
                const lineGen = d3.line<PeriodData>()
                    .x(d => (xScale(d.period) || 0) + barWidth / 2)
                    .y(d => lineYScale(d.dotSizeVal));

                if (lSettings.curveType === "smooth") {
                    lineGen.curve(d3.curveMonotoneX);
                } else if (lSettings.curveType === "step") {
                    lineGen.curve(d3.curveStep);
                } else {
                    lineGen.curve(d3.curveLinear);
                }

                let dashArray: string | null = null;
                if (lSettings.lineStyle === "dashed") dashArray = "6,4";
                else if (lSettings.lineStyle === "dotted") dashArray = "2,3";

                const linePath = plotGroup.append("path")
                    .datum(linePoints)
                    .attr("fill", "none")
                    .attr("stroke", lSettings.lineColor)
                    .attr("stroke-width", lSettings.strokeWidth)
                    .attr("d", lineGen);

                if (dashArray) linePath.attr("stroke-dasharray", dashArray);

                if (lSettings.showMarkers) {
                    let symbolType = d3.symbolCircle;
                    if (lSettings.markerShape === "square") symbolType = d3.symbolSquare;
                    else if (lSettings.markerShape === "triangle") symbolType = d3.symbolTriangle;
                    else if (lSettings.markerShape === "diamond") symbolType = d3.symbolDiamond;

                    const symbolGen = d3.symbol().type(symbolType).size(Math.pow(lSettings.markerSize * 2, 2));

                    linePoints.forEach(pt => {
                        const markerX = (xScale(pt.period) || 0) + barWidth / 2;
                        const markerY = lineYScale(pt.dotSizeVal);

                        const marker = plotGroup.append("path")
                            .attr("d", symbolGen)
                            .attr("transform", `translate(${markerX},${markerY})`)
                            .attr("fill", lSettings.markerColor)
                            .attr("stroke", "#FFFFFF")
                            .attr("stroke-width", 1.5)
                            .attr("cursor", "pointer");

                        const lineTooltip: VisualTooltipDataItem[] = [
                            { displayName: "Period", value: pt.period },
                            { displayName: "Line Metric", value: formatNumber(pt.dotSizeVal, lFmt.displayUnits, lFmt.decimalPlaces, lFmt.prefix, lFmt.suffix) }
                        ];

                        marker
                            .on("mouseover", (event: MouseEvent) => {
                                this.tooltipService.show({
                                    coordinates: [event.clientX, event.clientY],
                                    isTouchEvent: false,
                                    dataItems: lineTooltip,
                                    identities: []
                                });
                            })
                            .on("mousemove", (event: MouseEvent) => {
                                this.tooltipService.move({
                                    coordinates: [event.clientX, event.clientY],
                                    isTouchEvent: false,
                                    dataItems: lineTooltip,
                                    identities: []
                                });
                            })
                            .on("mouseout", () => {
                                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                            });
                    });
                }

                if (lSettings.showLabels) {
                    linePoints.forEach(pt => {
                        const lx = (xScale(pt.period) || 0) + barWidth / 2;
                        const ly = lineYScale(pt.dotSizeVal);
                        const labelY = lSettings.labelPosition === "below" ? ly + lSettings.markerSize + 12 : ly - lSettings.markerSize - 6;
                        const formattedLineVal = formatNumber(pt.dotSizeVal, lFmt.displayUnits, lFmt.decimalPlaces, lFmt.prefix, lFmt.suffix);

                        plotGroup.append("text")
                            .attr("x", lx)
                            .attr("y", labelY)
                            .attr("text-anchor", "middle")
                            .attr("font-size", `${lSettings.labelFontSize}px`)
                            .attr("font-weight", "bold")
                            .attr("fill", lSettings.labelColor)
                            .attr("pointer-events", "none")
                            .text(formattedLineVal);
                    });
                }
            }
        }

        if (this.settings.xAxisSettings.show) {
            const xAxis = d3.axisBottom(xScale);
            const xAxisGroup = plotGroup.append("g")
                .attr("transform", `translate(0,${innerHeight})`)
                .call(xAxis);

            const xTexts = xAxisGroup.selectAll("text")
                .attr("font-size", `${this.settings.xAxisSettings.fontSize}px`)
                .attr("fill", this.settings.xAxisSettings.fontColor);

            if (rotation !== 0) {
                if (rotation > 0) {
                    xTexts
                        .attr("transform", `rotate(${rotation})`)
                        .style("text-anchor", "start")
                        .attr("dx", "0.6em")
                        .attr("dy", rotation === 90 ? "-0.2em" : "0.5em");
                } else {
                    xTexts
                        .attr("transform", `rotate(${rotation})`)
                        .style("text-anchor", "end")
                        .attr("dx", "-0.6em")
                        .attr("dy", "0.5em");
                }
            }

            if (this.settings.xAxisSettings.showTitle && axisTitle) {
                const labelOffset = isRotated ? (Math.abs(rotation) === 90 ? 55 : 42) : 25;
                plotGroup.append("text")
                    .attr("x", innerWidth / 2)
                    .attr("y", innerHeight + labelOffset + this.settings.xAxisSettings.titleFontSize)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${this.settings.xAxisSettings.titleFontSize}px`)
                    .attr("font-weight", "600")
                    .attr("fill", this.settings.xAxisSettings.titleColor)
                    .text(axisTitle);
            }
        }

        if (this.settings.yAxisSettings.show) {
            const yFmt = this.settings.yAxisSettings.format;
            const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat((d) => {
                return formatNumber(Number(d), yFmt.displayUnits, yFmt.decimalPlaces, yFmt.prefix, yFmt.suffix);
            });
            const yAxisGroup = plotGroup.append("g").call(yAxis);

            yAxisGroup.selectAll("text")
                .attr("font-size", `${this.settings.yAxisSettings.fontSize}px`)
                .attr("fill", this.settings.yAxisSettings.fontColor);

            if (this.settings.yAxisSettings.showTitle && primaryYTitle) {
                plotGroup.append("text")
                    .attr("transform", `translate(${-margin.left + 14}, ${innerHeight / 2}) rotate(-90)`)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${this.settings.yAxisSettings.titleFontSize}px`)
                    .attr("font-weight", "600")
                    .attr("fill", this.settings.yAxisSettings.titleColor)
                    .text(primaryYTitle);
            }
        }

        if (showSecondaryAxis) {
            const syFmt = this.settings.secondaryYAxisSettings.format;
            const secAxis = d3.axisRight(ySecondaryScale).ticks(4).tickFormat((d) => {
                return formatNumber(Number(d), syFmt.displayUnits, syFmt.decimalPlaces, syFmt.prefix, syFmt.suffix);
            });

            const secAxisGroup = plotGroup.append("g")
                .attr("transform", `translate(${innerWidth},0)`)
                .call(secAxis);

            secAxisGroup.selectAll("text")
                .attr("font-size", `${this.settings.secondaryYAxisSettings.fontSize}px`)
                .attr("fill", this.settings.secondaryYAxisSettings.fontColor);

            if (this.settings.secondaryYAxisSettings.showTitle && secondaryYTitle) {
                plotGroup.append("text")
                    .attr("transform", `translate(${innerWidth + margin.right - 14}, ${innerHeight / 2}) rotate(90)`)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${this.settings.secondaryYAxisSettings.titleFontSize}px`)
                    .attr("font-weight", "600")
                    .attr("fill", this.settings.secondaryYAxisSettings.titleColor)
                    .text(secondaryYTitle);
            }
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const cards: powerbi.visuals.FormattingCard[] = [
            {
                displayName: "Colors & Themes",
                uid: "colorPaletteCard_uid",
                groups: [
                    {
                        displayName: "Ribbon Palette",
                        uid: "colorPaletteGroup_uid",
                        slices: [
                            {
                                uid: "palette_slice",
                                displayName: "Color Palette",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "colorPaletteSettings", propertyName: "palette" },
                                        value: this.settings.colorPaletteSettings.palette
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Legend",
                uid: "legendCard_uid",
                groups: [
                    {
                        displayName: "Display",
                        uid: "legendDisplayGroup_uid",
                        slices: [
                            {
                                uid: "legendShow_slice",
                                displayName: "Show Legend",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "legendSettings", propertyName: "show" },
                                        value: this.settings.legendSettings.show
                                    }
                                }
                            },
                            {
                                uid: "legendPosition_slice",
                                displayName: "Position",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "legendSettings", propertyName: "position" },
                                        value: this.settings.legendSettings.position
                                    }
                                }
                            },
                            {
                                uid: "legendFontSize_slice",
                                displayName: "Text Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "legendSettings", propertyName: "fontSize" },
                                        value: this.settings.legendSettings.fontSize
                                    }
                                }
                            },
                            {
                                uid: "legendFontColor_slice",
                                displayName: "Text Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "legendSettings", propertyName: "fontColor" },
                                        value: { value: this.settings.legendSettings.fontColor }
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Small Multiples",
                uid: "smallMultiplesCard_uid",
                groups: [
                    {
                        displayName: "Grid Layout",
                        uid: "smallMultiplesGroup_uid",
                        slices: [
                            {
                                uid: "smColumns_slice",
                                displayName: "Grid Columns",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "smallMultiplesSettings", propertyName: "columns" },
                                        value: this.settings.smallMultiplesSettings.columns
                                    }
                                }
                            },
                            {
                                uid: "smShowTitle_slice",
                                displayName: "Show Header",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "smallMultiplesSettings", propertyName: "showTitle" },
                                        value: this.settings.smallMultiplesSettings.showTitle
                                    }
                                }
                            },
                            {
                                uid: "smTitleFontSize_slice",
                                displayName: "Header Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "smallMultiplesSettings", propertyName: "titleFontSize" },
                                        value: this.settings.smallMultiplesSettings.titleFontSize
                                    }
                                }
                            },
                            {
                                uid: "smTitleColor_slice",
                                displayName: "Header Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "smallMultiplesSettings", propertyName: "titleColor" },
                                        value: { value: this.settings.smallMultiplesSettings.titleColor }
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Sorting & Order",
                uid: "sortSettingsCard_uid",
                groups: [
                    {
                        displayName: "Ordering Options",
                        uid: "sortGroup_uid",
                        slices: [
                            {
                                uid: "categorySort_slice",
                                displayName: "Stack Order",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "sortSettings", propertyName: "categorySort" },
                                        value: this.settings.sortSettings.categorySort
                                    }
                                }
                            },
                            {
                                uid: "axisSort_slice",
                                displayName: "Axis Order",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "sortSettings", propertyName: "axisSort" },
                                        value: this.settings.sortSettings.axisSort
                                    }
                                }
                            },
                            {
                                uid: "smallMultiplesSort_slice",
                                displayName: "Small Multiples Order",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "sortSettings", propertyName: "smallMultiplesSort" },
                                        value: this.settings.sortSettings.smallMultiplesSort
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Ribbons & Columns",
                uid: "barSettingsCard_uid",
                groups: [
                    {
                        displayName: "Ribbons & Layout",
                        uid: "barRibbonGroup_uid",
                        slices: [
                            {
                                uid: "ribbonOpacity_slice",
                                displayName: "Ribbon Opacity (%)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Slider,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "ribbonOpacity" },
                                        value: this.settings.barSettings.ribbonOpacity
                                    }
                                }
                            },
                            {
                                uid: "columnPadding_slice",
                                displayName: "Column Spacing (%)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Slider,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "columnPadding" },
                                        value: this.settings.barSettings.columnPadding
                                    }
                                }
                            }
                        ]
                    },
                    {
                        displayName: "Column Totals",
                        uid: "barTotalsGroup_uid",
                        slices: [
                            {
                                uid: "showBarTotals_slice",
                                displayName: "Show Column Totals",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "showBarTotals" },
                                        value: this.settings.barSettings.showBarTotals
                                    }
                                }
                            },
                            {
                                uid: "barTotalFontSize_slice",
                                displayName: "Total Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "barTotalFontSize" },
                                        value: this.settings.barSettings.barTotalFontSize
                                    }
                                }
                            },
                            {
                                uid: "barTotalColor_slice",
                                displayName: "Total Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "barTotalColor" },
                                        value: { value: this.settings.barSettings.barTotalColor }
                                    }
                                }
                            },
                            {
                                uid: "barDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "displayUnits" },
                                        value: this.settings.barSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "barDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.barSettings.format.decimalPlaces
                                    }
                                }
                            },
                            {
                                uid: "barPrefix_slice",
                                displayName: "Prefix / Symbol",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "prefix" },
                                        value: this.settings.barSettings.format.prefix
                                    }
                                }
                            },
                            {
                                uid: "barSuffix_slice",
                                displayName: "Suffix / Unit",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "barSettings", propertyName: "suffix" },
                                        value: this.settings.barSettings.format.suffix
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Ribbon Data Labels",
                uid: "ribbonLabelCard_uid",
                groups: [
                    {
                        displayName: "Segment Labels",
                        uid: "ribbonLabelGroup_uid",
                        slices: [
                            {
                                uid: "rLblShow_slice",
                                displayName: "Show Segment Labels",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "show" },
                                        value: this.settings.ribbonLabelSettings.show
                                    }
                                }
                            },
                            {
                                uid: "rLblFontSize_slice",
                                displayName: "Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "fontSize" },
                                        value: this.settings.ribbonLabelSettings.fontSize
                                    }
                                }
                            },
                            {
                                uid: "rLblFontColor_slice",
                                displayName: "Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "fontColor" },
                                        value: { value: this.settings.ribbonLabelSettings.fontColor }
                                    }
                                }
                            },
                            {
                                uid: "rLblDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "displayUnits" },
                                        value: this.settings.ribbonLabelSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "rLblDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.ribbonLabelSettings.format.decimalPlaces
                                    }
                                }
                            },
                            {
                                uid: "rLblPrefix_slice",
                                displayName: "Prefix / Symbol",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "prefix" },
                                        value: this.settings.ribbonLabelSettings.format.prefix
                                    }
                                }
                            },
                            {
                                uid: "rLblSuffix_slice",
                                displayName: "Suffix / Unit",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "ribbonLabelSettings", propertyName: "suffix" },
                                        value: this.settings.ribbonLabelSettings.format.suffix
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Overlay Mode",
                uid: "overlayCard_uid",
                groups: [
                    {
                        displayName: "Display",
                        uid: "overlayModeGroup_uid",
                        slices: [
                            {
                                uid: "overlayMode_slice",
                                displayName: "Overlay Style",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "overlaySettings", propertyName: "mode" },
                                        value: this.settings.overlaySettings.mode
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Line Graph Options",
                uid: "lineSettingsCard_uid",
                groups: [
                    {
                        displayName: "Line Stroke",
                        uid: "lineStrokeGroup_uid",
                        slices: [
                            {
                                uid: "lineColor_slice",
                                displayName: "Line Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "lineColor" },
                                        value: { value: this.settings.lineSettings.lineColor }
                                    }
                                }
                            },
                            {
                                uid: "strokeWidth_slice",
                                displayName: "Line Width (px)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Slider,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "strokeWidth" },
                                        value: this.settings.lineSettings.strokeWidth
                                    }
                                }
                            },
                            {
                                uid: "lineStyle_slice",
                                displayName: "Line Style",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "lineStyle" },
                                        value: this.settings.lineSettings.lineStyle
                                    }
                                }
                            },
                            {
                                uid: "curveType_slice",
                                displayName: "Interpolation",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "curveType" },
                                        value: this.settings.lineSettings.curveType
                                    }
                                }
                            },
                            {
                                uid: "useSecondaryAxis_slice",
                                displayName: "Use Secondary Y Axis",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "useSecondaryAxis" },
                                        value: this.settings.lineSettings.useSecondaryAxis
                                    }
                                }
                            }
                        ]
                    },
                    {
                        displayName: "Line Markers",
                        uid: "lineMarkerGroup_uid",
                        slices: [
                            {
                                uid: "showMarkers_slice",
                                displayName: "Show Markers",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "showMarkers" },
                                        value: this.settings.lineSettings.showMarkers
                                    }
                                }
                            },
                            {
                                uid: "markerShape_slice",
                                displayName: "Marker Shape",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "markerShape" },
                                        value: this.settings.lineSettings.markerShape
                                    }
                                }
                            },
                            {
                                uid: "markerSize_slice",
                                displayName: "Marker Size (px)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "markerSize" },
                                        value: this.settings.lineSettings.markerSize
                                    }
                                }
                            },
                            {
                                uid: "markerColor_slice",
                                displayName: "Marker Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "markerColor" },
                                        value: { value: this.settings.lineSettings.markerColor }
                                    }
                                }
                            }
                        ]
                    },
                    {
                        displayName: "Line Data Labels",
                        uid: "lineLabelGroup_uid",
                        slices: [
                            {
                                uid: "lineShowLabels_slice",
                                displayName: "Show Line Labels",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "showLabels" },
                                        value: this.settings.lineSettings.showLabels
                                    }
                                }
                            },
                            {
                                uid: "lineLabelPos_slice",
                                displayName: "Position",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "labelPosition" },
                                        value: this.settings.lineSettings.labelPosition
                                    }
                                }
                            },
                            {
                                uid: "lineLabelFontSize_slice",
                                displayName: "Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "labelFontSize" },
                                        value: this.settings.lineSettings.labelFontSize
                                    }
                                }
                            },
                            {
                                uid: "lineLabelColor_slice",
                                displayName: "Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "labelColor" },
                                        value: { value: this.settings.lineSettings.labelColor }
                                    }
                                }
                            },
                            {
                                uid: "lineDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "displayUnits" },
                                        value: this.settings.lineSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "lineDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.lineSettings.format.decimalPlaces
                                    }
                                }
                            },
                            {
                                uid: "linePrefix_slice",
                                displayName: "Prefix / Symbol",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "prefix" },
                                        value: this.settings.lineSettings.format.prefix
                                    }
                                }
                            },
                            {
                                uid: "lineSuffix_slice",
                                displayName: "Suffix / Unit",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "lineSettings", propertyName: "suffix" },
                                        value: this.settings.lineSettings.format.suffix
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Overlay Dots",
                uid: "dotSettingsCard_uid",
                groups: [
                    {
                        displayName: "Appearance",
                        uid: "dotAppearanceGroup_uid",
                        slices: [
                            {
                                uid: "dotColor_slice",
                                displayName: "Dot Fill Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "dotSettings", propertyName: "dotColor" },
                                        value: { value: this.settings.dotSettings.dotColor }
                                    }
                                }
                            },
                            {
                                uid: "maxDotRadius_slice",
                                displayName: "Max Radius (px)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "dotSettings", propertyName: "maxDotRadius" },
                                        value: this.settings.dotSettings.maxDotRadius
                                    }
                                }
                            },
                            {
                                uid: "dotOpacity_slice",
                                displayName: "Opacity (%)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Slider,
                                    properties: {
                                        descriptor: { objectName: "dotSettings", propertyName: "dotOpacity" },
                                        value: this.settings.dotSettings.dotOpacity
                                    }
                                }
                            },
                            {
                                uid: "dotStrokeColor_slice",
                                displayName: "Border Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "dotSettings", propertyName: "dotStrokeColor" },
                                        value: { value: this.settings.dotSettings.dotStrokeColor }
                                    }
                                }
                            },
                            {
                                uid: "dotStrokeWidth_slice",
                                displayName: "Border Width (px)",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "dotSettings", propertyName: "dotStrokeWidth" },
                                        value: this.settings.dotSettings.dotStrokeWidth
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Dot Callouts / Labels",
                uid: "dotLabelSettingsCard_uid",
                groups: [
                    {
                        displayName: "Display & Number Formatting",
                        uid: "dotLabelGroup_uid",
                        slices: [
                            {
                                uid: "showDotTotals_slice",
                                displayName: "Show Dot Totals",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "showDotTotals" },
                                        value: this.settings.dotLabelSettings.showDotTotals
                                    }
                                }
                            },
                            {
                                uid: "labelPosition_slice",
                                displayName: "Position",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "labelPosition" },
                                        value: this.settings.dotLabelSettings.labelPosition
                                    }
                                }
                            },
                            {
                                uid: "labelFontSize_slice",
                                displayName: "Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "labelFontSize" },
                                        value: this.settings.dotLabelSettings.labelFontSize
                                    }
                                }
                            },
                            {
                                uid: "labelColor_slice",
                                displayName: "Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "labelColor" },
                                        value: { value: this.settings.dotLabelSettings.labelColor }
                                    }
                                }
                            },
                            {
                                uid: "dotDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "displayUnits" },
                                        value: this.settings.dotLabelSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "dotDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.dotLabelSettings.format.decimalPlaces
                                    }
                                }
                            },
                            {
                                uid: "dotPrefix_slice",
                                displayName: "Prefix / Symbol",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "prefix" },
                                        value: this.settings.dotLabelSettings.format.prefix
                                    }
                                }
                            },
                            {
                                uid: "dotSuffix_slice",
                                displayName: "Suffix / Unit",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "dotLabelSettings", propertyName: "suffix" },
                                        value: this.settings.dotLabelSettings.format.suffix
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Primary Y Axis & Scale",
                uid: "yAxisCard_uid",
                groups: [
                    {
                        displayName: "Scale & Units",
                        uid: "yAxisGroup_uid",
                        slices: [
                            {
                                uid: "yAxisShow_slice",
                                displayName: "Show Y Axis",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "show" },
                                        value: this.settings.yAxisSettings.show
                                    }
                                }
                            },
                            {
                                uid: "yAxisShowTitle_slice",
                                displayName: "Show Axis Title",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "showTitle" },
                                        value: this.settings.yAxisSettings.showTitle
                                    }
                                }
                            },
                            {
                                uid: "yAxisTitleFontSize_slice",
                                displayName: "Title Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "titleFontSize" },
                                        value: this.settings.yAxisSettings.titleFontSize
                                    }
                                }
                            },
                            {
                                uid: "yAxisTitleColor_slice",
                                displayName: "Title Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "titleColor" },
                                        value: { value: this.settings.yAxisSettings.titleColor }
                                    }
                                }
                            },
                            {
                                uid: "yAxisScaleType_slice",
                                displayName: "Scale Type",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "scaleType" },
                                        value: this.settings.yAxisSettings.scaleType
                                    }
                                }
                            },
                            {
                                uid: "yAxisMin_slice",
                                displayName: "Axis Minimum",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "customMin" },
                                        value: this.settings.yAxisSettings.customMin ?? 0
                                    }
                                }
                            },
                            {
                                uid: "yAxisMax_slice",
                                displayName: "Axis Maximum",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "customMax" },
                                        value: this.settings.yAxisSettings.customMax ?? 0
                                    }
                                }
                            },
                            {
                                uid: "yAxisDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "displayUnits" },
                                        value: this.settings.yAxisSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "yAxisDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.yAxisSettings.format.decimalPlaces
                                    }
                                }
                            },
                            {
                                uid: "yAxisGridlines_slice",
                                displayName: "Show Gridlines",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "showGridlines" },
                                        value: this.settings.yAxisSettings.showGridlines
                                    }
                                }
                            },
                            {
                                uid: "yAxisGridColor_slice",
                                displayName: "Gridline Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "yAxisSettings", propertyName: "gridlineColor" },
                                        value: { value: this.settings.yAxisSettings.gridlineColor }
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "Secondary Y Axis (Line)",
                uid: "secYAxisCard_uid",
                groups: [
                    {
                        displayName: "Scale & Options",
                        uid: "secYAxisGroup_uid",
                        slices: [
                            {
                                uid: "secYShow_slice",
                                displayName: "Show Secondary Y Axis",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "show" },
                                        value: this.settings.secondaryYAxisSettings.show
                                    }
                                }
                            },
                            {
                                uid: "secYShowTitle_slice",
                                displayName: "Show Axis Title",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "showTitle" },
                                        value: this.settings.secondaryYAxisSettings.showTitle
                                    }
                                }
                            },
                            {
                                uid: "secYTitleFontSize_slice",
                                displayName: "Title Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "titleFontSize" },
                                        value: this.settings.secondaryYAxisSettings.titleFontSize
                                    }
                                }
                            },
                            {
                                uid: "secYTitleColor_slice",
                                displayName: "Title Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "titleColor" },
                                        value: { value: this.settings.secondaryYAxisSettings.titleColor }
                                    }
                                }
                            },
                            {
                                uid: "secYScaleType_slice",
                                displayName: "Scale Type",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "scaleType" },
                                        value: this.settings.secondaryYAxisSettings.scaleType
                                    }
                                }
                            },
                            {
                                uid: "secYMin_slice",
                                displayName: "Axis Minimum",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "customMin" },
                                        value: this.settings.secondaryYAxisSettings.customMin ?? 0
                                    }
                                }
                            },
                            {
                                uid: "secYMax_slice",
                                displayName: "Axis Maximum",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "customMax" },
                                        value: this.settings.secondaryYAxisSettings.customMax ?? 0
                                    }
                                }
                            },
                            {
                                uid: "secYDisplayUnits_slice",
                                displayName: "Display Units",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "displayUnits" },
                                        value: this.settings.secondaryYAxisSettings.format.displayUnits
                                    }
                                }
                            },
                            {
                                uid: "secYDecimalPlaces_slice",
                                displayName: "Decimal Places",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "secondaryYAxisSettings", propertyName: "decimalPlaces" },
                                        value: this.settings.secondaryYAxisSettings.format.decimalPlaces
                                    }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                displayName: "X Axis",
                uid: "xAxisCard_uid",
                groups: [
                    {
                        displayName: "Labels",
                        uid: "xAxisGroup_uid",
                        slices: [
                            {
                                uid: "xAxisShow_slice",
                                displayName: "Show X Axis",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "show" },
                                        value: this.settings.xAxisSettings.show
                                    }
                                }
                            },
                            {
                                uid: "xAxisRotation_slice",
                                displayName: "Label Rotation",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.Dropdown,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "labelRotation" },
                                        value: this.settings.xAxisSettings.labelRotation
                                    }
                                }
                            },
                            {
                                uid: "xAxisFontSize_slice",
                                displayName: "Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "fontSize" },
                                        value: this.settings.xAxisSettings.fontSize
                                    }
                                }
                            },
                            {
                                uid: "xAxisFontColor_slice",
                                displayName: "Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "fontColor" },
                                        value: { value: this.settings.xAxisSettings.fontColor }
                                    }
                                }
                            },
                            {
                                uid: "xAxisShowTitle_slice",
                                displayName: "Show Axis Title",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ToggleSwitch,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "showTitle" },
                                        value: this.settings.xAxisSettings.showTitle
                                    }
                                }
                            },
                            {
                                uid: "xAxisTitleFontSize_slice",
                                displayName: "Title Font Size",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.NumUpDown,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "titleFontSize" },
                                        value: this.settings.xAxisSettings.titleFontSize
                                    }
                                }
                            },
                            {
                                uid: "xAxisTitleColor_slice",
                                displayName: "Title Font Color",
                                control: {
                                    type: powerbi.visuals.FormattingComponent.ColorPicker,
                                    properties: {
                                        descriptor: { objectName: "xAxisSettings", propertyName: "titleColor" },
                                        value: { value: this.settings.xAxisSettings.titleColor }
                                    }
                                }
                            }
                        ]
                    }
                ]
            }
        ];

        return { cards };
    }

    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        const instances: VisualObjectInstance[] = [];

        switch (options.objectName) {
            case "colorPaletteSettings":
                instances.push({
                    objectName: "colorPaletteSettings",
                    selector: (null as any),
                    properties: { palette: this.settings.colorPaletteSettings.palette }
                });
                break;
            case "legendSettings":
                instances.push({
                    objectName: "legendSettings",
                    selector: (null as any),
                    properties: {
                        show: this.settings.legendSettings.show,
                        position: this.settings.legendSettings.position,
                        fontSize: this.settings.legendSettings.fontSize,
                        fontColor: { solid: { color: this.settings.legendSettings.fontColor } }
                    }
                });
                break;
            case "smallMultiplesSettings":
                instances.push({
                    objectName: "smallMultiplesSettings",
                    selector: (null as any),
                    properties: {
                        columns: this.settings.smallMultiplesSettings.columns,
                        showTitle: this.settings.smallMultiplesSettings.showTitle,
                        titleFontSize: this.settings.smallMultiplesSettings.titleFontSize,
                        titleColor: { solid: { color: this.settings.smallMultiplesSettings.titleColor } }
                    }
                });
                break;
            case "sortSettings":
                instances.push({
                    objectName: "sortSettings",
                    selector: (null as any),
                    properties: {
                        categorySort: this.settings.sortSettings.categorySort,
                        axisSort: this.settings.sortSettings.axisSort,
                        smallMultiplesSort: this.settings.sortSettings.smallMultiplesSort
                    }
                });
                break;
            case "barSettings":
                instances.push({
                    objectName: "barSettings",
                    selector: (null as any),
                    properties: {
                        ribbonOpacity: this.settings.barSettings.ribbonOpacity,
                        columnPadding: this.settings.barSettings.columnPadding,
                        showBarTotals: this.settings.barSettings.showBarTotals,
                        barTotalFontSize: this.settings.barSettings.barTotalFontSize,
                        barTotalColor: { solid: { color: this.settings.barSettings.barTotalColor } },
                        displayUnits: this.settings.barSettings.format.displayUnits,
                        decimalPlaces: this.settings.barSettings.format.decimalPlaces,
                        prefix: this.settings.barSettings.format.prefix,
                        suffix: this.settings.barSettings.format.suffix
                    }
                });
                break;
            case "ribbonLabelSettings":
                instances.push({
                    objectName: "ribbonLabelSettings",
                    selector: (null as any),
                    properties: {
                        show: this.settings.ribbonLabelSettings.show,
                        fontSize: this.settings.ribbonLabelSettings.fontSize,
                        fontColor: { solid: { color: this.settings.ribbonLabelSettings.fontColor } },
                        displayUnits: this.settings.ribbonLabelSettings.format.displayUnits,
                        decimalPlaces: this.settings.ribbonLabelSettings.format.decimalPlaces,
                        prefix: this.settings.ribbonLabelSettings.format.prefix,
                        suffix: this.settings.ribbonLabelSettings.format.suffix
                    }
                });
                break;
            case "overlaySettings":
                instances.push({
                    objectName: "overlaySettings",
                    selector: (null as any),
                    properties: { mode: this.settings.overlaySettings.mode }
                });
                break;
            case "lineSettings":
                instances.push({
                    objectName: "lineSettings",
                    selector: (null as any),
                    properties: {
                        lineColor: { solid: { color: this.settings.lineSettings.lineColor } },
                        strokeWidth: this.settings.lineSettings.strokeWidth,
                        lineStyle: this.settings.lineSettings.lineStyle,
                        curveType: this.settings.lineSettings.curveType,
                        useSecondaryAxis: this.settings.lineSettings.useSecondaryAxis,
                        showMarkers: this.settings.lineSettings.showMarkers,
                        markerShape: this.settings.lineSettings.markerShape,
                        markerSize: this.settings.lineSettings.markerSize,
                        markerColor: { solid: { color: this.settings.lineSettings.markerColor } },
                        showLabels: this.settings.lineSettings.showLabels,
                        labelPosition: this.settings.lineSettings.labelPosition,
                        labelFontSize: this.settings.lineSettings.labelFontSize,
                        labelColor: { solid: { color: this.settings.lineSettings.labelColor } },
                        displayUnits: this.settings.lineSettings.format.displayUnits,
                        decimalPlaces: this.settings.lineSettings.format.decimalPlaces,
                        prefix: this.settings.lineSettings.format.prefix,
                        suffix: this.settings.lineSettings.format.suffix
                    }
                });
                break;
            case "dotSettings":
                instances.push({
                    objectName: "dotSettings",
                    selector: (null as any),
                    properties: {
                        dotColor: { solid: { color: this.settings.dotSettings.dotColor } },
                        maxDotRadius: this.settings.dotSettings.maxDotRadius,
                        dotOpacity: this.settings.dotSettings.dotOpacity,
                        dotStrokeColor: { solid: { color: this.settings.dotSettings.dotStrokeColor } },
                        dotStrokeWidth: this.settings.dotSettings.dotStrokeWidth
                    }
                });
                break;
            case "dotLabelSettings":
                instances.push({
                    objectName: "dotLabelSettings",
                    selector: (null as any),
                    properties: {
                        showDotTotals: this.settings.dotLabelSettings.showDotTotals,
                        labelPosition: this.settings.dotLabelSettings.labelPosition,
                        labelFontSize: this.settings.dotLabelSettings.labelFontSize,
                        labelColor: { solid: { color: this.settings.dotLabelSettings.labelColor } },
                        displayUnits: this.settings.dotLabelSettings.format.displayUnits,
                        decimalPlaces: this.settings.dotLabelSettings.format.decimalPlaces,
                        prefix: this.settings.dotLabelSettings.format.prefix,
                        suffix: this.settings.dotLabelSettings.format.suffix
                    }
                });
                break;
            case "yAxisSettings":
                instances.push({
                    objectName: "yAxisSettings",
                    selector: (null as any),
                    properties: {
                        show: this.settings.yAxisSettings.show,
                        showTitle: this.settings.yAxisSettings.showTitle,
                        titleFontSize: this.settings.yAxisSettings.titleFontSize,
                        titleColor: { solid: { color: this.settings.yAxisSettings.titleColor } },
                        scaleType: this.settings.yAxisSettings.scaleType,
                        customMin: this.settings.yAxisSettings.customMin ?? 0,
                        customMax: this.settings.yAxisSettings.customMax ?? 0,
                        fontSize: this.settings.yAxisSettings.fontSize,
                        fontColor: { solid: { color: this.settings.yAxisSettings.fontColor } },
                        displayUnits: this.settings.yAxisSettings.format.displayUnits,
                        decimalPlaces: this.settings.yAxisSettings.format.decimalPlaces
                    }
                });
                break;
            case "secondaryYAxisSettings":
                instances.push({
                    objectName: "secondaryYAxisSettings",
                    selector: (null as any),
                    properties: {
                        show: this.settings.secondaryYAxisSettings.show,
                        showTitle: this.settings.secondaryYAxisSettings.showTitle,
                        titleFontSize: this.settings.secondaryYAxisSettings.titleFontSize,
                        titleColor: { solid: { color: this.settings.secondaryYAxisSettings.titleColor } },
                        scaleType: this.settings.secondaryYAxisSettings.scaleType,
                        customMin: this.settings.secondaryYAxisSettings.customMin ?? 0,
                        customMax: this.settings.secondaryYAxisSettings.customMax ?? 0,
                        fontSize: this.settings.secondaryYAxisSettings.fontSize,
                        fontColor: { solid: { color: this.settings.secondaryYAxisSettings.fontColor } },
                        displayUnits: this.settings.secondaryYAxisSettings.format.displayUnits,
                        decimalPlaces: this.settings.secondaryYAxisSettings.format.decimalPlaces
                    }
                });
                break;
            case "xAxisSettings":
                instances.push({
                    objectName: "xAxisSettings",
                    selector: (null as any),
                    properties: {
                        show: this.settings.xAxisSettings.show,
                        labelRotation: this.settings.xAxisSettings.labelRotation,
                        fontSize: this.settings.xAxisSettings.fontSize,
                        fontColor: { solid: { color: this.settings.xAxisSettings.fontColor } },
                        showTitle: this.settings.xAxisSettings.showTitle,
                        titleFontSize: this.settings.xAxisSettings.titleFontSize,
                        titleColor: { solid: { color: this.settings.xAxisSettings.titleColor } }
                    }
                });
                break;
        }

        return instances;
    }
}