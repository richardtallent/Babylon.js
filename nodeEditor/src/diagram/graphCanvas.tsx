import * as React from "react";
import { GlobalState } from '../globalState';
import { NodeMaterialBlock } from 'babylonjs/Materials/Node/nodeMaterialBlock';
import { GraphNode } from './graphNode';
import * as dagre from 'dagre';
import { Nullable } from 'babylonjs/types';
import { NodeLink } from './nodeLink';
import { NodePort } from './nodePort';
import { NodeMaterialConnectionPoint, NodeMaterialConnectionPointDirection, NodeMaterialConnectionPointCompatibilityStates } from 'babylonjs/Materials/Node/nodeMaterialBlockConnectionPoint';
import { Vector2 } from 'babylonjs/Maths/math.vector';
import { FragmentOutputBlock } from 'babylonjs/Materials/Node/Blocks/Fragment/fragmentOutputBlock';
import { InputBlock } from 'babylonjs/Materials/Node/Blocks/Input/inputBlock';
import { DataStorage } from '../dataStorage';

require("./graphCanvas.scss");

export interface IGraphCanvasComponentProps {
    globalState: GlobalState
}

export class GraphCanvasComponent extends React.Component<IGraphCanvasComponentProps> {
    private _hostCanvas: HTMLDivElement;
    private _graphCanvas: HTMLDivElement;
    private _svgCanvas: HTMLElement;
    private _rootContainer: HTMLDivElement;
    private _nodes: GraphNode[] = [];
    private _links: NodeLink[] = [];
    private _mouseStartPointX: Nullable<number> = null;
    private _mouseStartPointY: Nullable<number> = null
    private _dropPointX = 0;
    private _dropPointY = 0;
    private _x = 0;
    private _y = 0;
    private _zoom = 1;
    private _selectedNodes: GraphNode[] = [];
    private _selectedLink: Nullable<NodeLink> = null;
    private _candidateLink: Nullable<NodeLink> = null;
    private _candidatePort: Nullable<NodePort> = null;
    private _gridSize = 20;

    private _altKeyIsPressed = false;
    private _ctrlKeyIsPressed = false;
    private _oldY = -1;

    public get gridSize() {
        return this._gridSize;
    }

    public set gridSize(value: number) {
        if (this._gridSize === value) {
            return;
        }
        this._gridSize = value;

        this._hostCanvas.style.backgroundSize = `${value}px ${value}px`;
    }

    public get globalState(){
        return this.props.globalState;
    }

    public get nodes() {
        return this._nodes;
    }

    public get links() {
        return this._links;
    }

    public get zoom() {
        return this._zoom;
    }

    public set zoom(value: number) {
        if (this._zoom === value) {
            return;
        }

        this._zoom = value;
        
        this.updateTransform();
    }    

    public get x() {
        return this._x;
    }

    public set x(value: number) {
        this._x = value;
        
        this.updateTransform();
    }

    public get y() {
        return this._y;
    }

    public set y(value: number) {
        this._y = value;
        
        this.updateTransform();
    }

    public get selectedNodes() {
        return this._selectedNodes;
    }

    public get selectedLink() {
        return this._selectedLink;
    }

    public get canvasContainer() {
        return this._graphCanvas;
    }

    public get svgCanvas() {
        return this._svgCanvas;
    }

    constructor(props: IGraphCanvasComponentProps) {
        super(props);

        props.globalState.onSelectionChangedObservable.add(selection => {
            
            if (!selection) {
                this._selectedNodes = [];
                this._selectedLink = null;
            } else {
                if (selection instanceof NodeLink) {
                    this._selectedLink = selection;
                } else {
                    if (this._ctrlKeyIsPressed) {
                        if (this._selectedNodes.indexOf(selection) === -1) {
                            this._selectedNodes.push(selection);
                        }
                    } else {                    
                        this._selectedNodes = [selection];
                    }
                }
            }
        });

        props.globalState.onCandidatePortSelected.add(port => {
            this._candidatePort = port;
        });

        props.globalState.onGridSizeChanged.add(() => {
            this.gridSize = DataStorage.ReadNumber("GridSize", 20);
        });

        this.props.globalState.hostDocument!.addEventListener("keyup", () => this.onKeyUp(), false);
        this.props.globalState.hostDocument!.addEventListener("keydown", evt => {
            this._altKeyIsPressed = evt.altKey;            
            this._ctrlKeyIsPressed = evt.ctrlKey;
        }, false);
        this.props.globalState.hostDocument!.defaultView!.addEventListener("blur", () => {
            this._altKeyIsPressed = false;
            this._ctrlKeyIsPressed = false;
        }, false);     
    }

    public getGridPosition(position: number) {
        let gridSize = this.gridSize;
		if (gridSize === 0) {
			return position;
		}
		return gridSize * Math.floor((position + gridSize / 2) / gridSize);
	}

    updateTransform() {
        this._rootContainer.style.transform = `translate(${this._x}px, ${this._y}px) scale(${this._zoom})`;
    }

    onKeyUp() {        
        this._altKeyIsPressed = false;
        this._ctrlKeyIsPressed = false;
        this._oldY = -1;
    }

    findNodeFromBlock(block: NodeMaterialBlock) {
        return this.nodes.filter(n => n.block === block)[0];
    }

    reset() {
        for (var node of this._nodes) {
            node.dispose();
        }
        this._nodes = [];
        this._links = [];
        this._graphCanvas.innerHTML = "";
        this._svgCanvas.innerHTML = "";
    }

    connectPorts(pointA: NodeMaterialConnectionPoint, pointB: NodeMaterialConnectionPoint) {
        var blockA = pointA.ownerBlock;
        var blockB = pointB.ownerBlock;
        var nodeA = this.findNodeFromBlock(blockA);
        var nodeB = this.findNodeFromBlock(blockB);

        if (!nodeA || !nodeB) {
            return;
        }

        var portA = nodeA.getPortForConnectionPoint(pointA);
        var portB = nodeB.getPortForConnectionPoint(pointB);

        if (!portA || !portB) {
            return;
        }

        for (var currentLink of this._links) {
            if (currentLink.portA === portA && currentLink.portB === portB) {
                return;
            }
            if (currentLink.portA === portB && currentLink.portB === portA) {
                return;
            }
        }

        const link = new NodeLink(this, portA, nodeA, portB, nodeB);
        this._links.push(link);

        nodeA.links.push(link);
        nodeB.links.push(link);
    }

    removeLink(link: NodeLink) {
        let index = this._links.indexOf(link);

        if (index > -1) {
            this._links.splice(index, 1);
        }

        link.dispose();
    }

    appendBlock(block: NodeMaterialBlock) {
        let newNode = new GraphNode(block, this.props.globalState);

        newNode.appendVisual(this._graphCanvas, this);

        this._nodes.push(newNode);

        return newNode;
    }

    distributeGraph() {
        this.x = 0;
        this.y = 0;
        this.zoom = 1;

        let graph = new dagre.graphlib.Graph();
        graph.setGraph({});
        graph.setDefaultEdgeLabel(() => ({}));
        graph.graph().rankdir = "LR";

        // Build dagre graph
        this._nodes.forEach(node => {
            graph.setNode(node.id.toString(), {
                id: node.id,
                width: node.width,
                height: node.height
            });
        });

        this._nodes.forEach(node => {
            node.block.outputs.forEach(output => {
                if (!output.hasEndpoints) {
                    return;
                }

                output.endpoints.forEach(endpoint => {
                    graph.setEdge(node.id.toString(), endpoint.ownerBlock.uniqueId.toString());
                });
            });
        });

        // Distribute
        dagre.layout(graph);

        // Update graph
        let dagreNodes = graph.nodes().map(node => graph.node(node));
        dagreNodes.forEach(dagreNode => {
            for (var node of this._nodes) {
                if (node.id === dagreNode.id) {
                    node.x = this.getGridPosition(dagreNode.x - dagreNode.width / 2);
                    node.y = this.getGridPosition(dagreNode.y - dagreNode.height / 2);
                    return;
                }
            }
        });        
    }

    componentDidMount() {
        this._hostCanvas = this.props.globalState.hostDocument.getElementById("graph-canvas") as HTMLDivElement;
        this._rootContainer = this.props.globalState.hostDocument.getElementById("graph-container") as HTMLDivElement;
        this._graphCanvas = this.props.globalState.hostDocument.getElementById("graph-canvas-container") as HTMLDivElement;
        this._svgCanvas = this.props.globalState.hostDocument.getElementById("graph-svg-container") as HTMLElement;        
        
        this.gridSize = DataStorage.ReadNumber("GridSize", 20);
        this.updateTransform();
    }    

    onMove(evt: React.PointerEvent) {        
        // Candidate link
        if (this._candidateLink) {        
            const rootRect = this.canvasContainer.getBoundingClientRect();       
            this._candidatePort = null; 
            this.props.globalState.onCandidateLinkMoved.notifyObservers(new Vector2(evt.pageX, evt.pageY));
            this._dropPointX = (evt.pageX - rootRect.left) / this.zoom;
            this._dropPointY = (evt.pageY - rootRect.top) / this.zoom;

            this._candidateLink.update(this._dropPointX, this._dropPointY, true);
            
            return;
        }          

        // Zoom with mouse + alt
        if (this._altKeyIsPressed && evt.buttons === 1) {
            if (this._oldY < 0) {
                this._oldY = evt.pageY;
            }

            let zoomDelta = (evt.pageY - this._oldY) / 10;
            if (Math.abs(zoomDelta) > 5) {
                this.zoom += zoomDelta / 100;
                this._oldY = evt.pageY;      
            }
            return;
        }   

        // Move canvas
        this._rootContainer.style.cursor = "move";

        if (this._mouseStartPointX === null || this._mouseStartPointY === null) {
            return;
        }
        this.x += evt.clientX - this._mouseStartPointX;
        this.y += evt.clientY - this._mouseStartPointY;

        this._mouseStartPointX = evt.clientX;
        this._mouseStartPointY = evt.clientY;
    }

    onDown(evt: React.PointerEvent<HTMLElement>) {
        this._rootContainer.setPointerCapture(evt.pointerId);

        if (evt.nativeEvent.srcElement && (evt.nativeEvent.srcElement as HTMLElement).nodeName === "IMG") {
            if (!this._candidateLink) {
                let portElement = ((evt.nativeEvent.srcElement as HTMLElement).parentElement as any).port as NodePort;
                this._candidateLink = new NodeLink(this, portElement, portElement.node);
            }  
            return;
        }

        this.props.globalState.onSelectionChangedObservable.notifyObservers(null);
        this._mouseStartPointX = evt.clientX;
        this._mouseStartPointY = evt.clientY;
        
    }

    onUp(evt: React.PointerEvent) {
        this._mouseStartPointX = null;
        this._mouseStartPointY = null;
        this._rootContainer.releasePointerCapture(evt.pointerId);   
        this._oldY = -1; 

        if (this._candidateLink) {        
            this.processCandidatePort();          
            this.props.globalState.onCandidateLinkMoved.notifyObservers(null);
            this._candidateLink.dispose();
            this._candidateLink = null;
            this._candidatePort = null;
        }
    }

    onWheel(evt: React.WheelEvent) {
        let delta = evt.deltaY < 0 ? 0.1 : -0.1;

        let oldZoom = this.zoom;
        this.zoom = Math.min(Math.max(0.1, this.zoom + delta), 4);

        const boundingRect = evt.currentTarget.getBoundingClientRect();
        const clientWidth = boundingRect.width;
        const clientHeight = boundingRect.height;
        const widthDiff = clientWidth * this.zoom - clientWidth * oldZoom;
        const heightDiff = clientHeight * this.zoom - clientHeight * oldZoom;
        const clientX = evt.clientX - boundingRect.left;
        const clientY = evt.clientY - boundingRect.top;

        const xFactor = (clientX - this.x) / oldZoom / clientWidth;
        const yFactor = (clientY - this.y) / oldZoom / clientHeight;

        this.x = this.x - widthDiff * xFactor;
        this.y = this.y - heightDiff * yFactor;

        evt.stopPropagation();
    }

    zoomToFit() {
        const xFactor = this._rootContainer.clientWidth / this._rootContainer.scrollWidth;
        const yFactor = this._rootContainer.clientHeight / this._rootContainer.scrollHeight;
        const zoomFactor = xFactor < yFactor ? xFactor : yFactor;
        
        this.zoom = zoomFactor;
        this.x = 0;
        this.y = 0;
    }

    processCandidatePort() {
        let pointB = this._candidateLink!.portA.connectionPoint;
        let nodeB = this._candidateLink!.portA.node;
        let pointA: NodeMaterialConnectionPoint;
        let nodeA: GraphNode;

        if (this._candidatePort) {
            pointA = this._candidatePort.connectionPoint;
            nodeA = this._candidatePort.node;
        } else {
            if (pointB.direction === NodeMaterialConnectionPointDirection.Output) {
                return;
            }

            // No destination so let's spin a new input block
            let inputBlock = new InputBlock("", undefined, this._candidateLink!.portA.connectionPoint.type);
            pointA = inputBlock.output;
            nodeA = this.appendBlock(inputBlock);
            
            nodeA.x = this._dropPointX - 200;
            nodeA.y = this._dropPointY - 50;    
        }

        if (pointA.direction === NodeMaterialConnectionPointDirection.Input) {
            let temp = pointB;
            pointB = pointA;
            pointA = temp;

            let tempNode = nodeA;
            nodeA = nodeB;
            nodeB = tempNode;
        }

        if (pointB.connectedPoint === pointA) {
            return;
        }

        if (pointB === pointA) {
            return;
        }

        if (pointB.direction === pointA.direction) {
            return;
        }

        // Check compatibility
        let isFragmentOutput = pointB.ownerBlock.getClassName() === "FragmentOutputBlock";
        let compatibilityState = pointA.checkCompatibilityState(pointB);
        if (compatibilityState === NodeMaterialConnectionPointCompatibilityStates.Compatible) {
            if (isFragmentOutput) {
                let fragmentBlock = pointB.ownerBlock as FragmentOutputBlock;

                if (pointB.name === "rgb" && fragmentBlock.rgba.isConnected) {
                    nodeB.getLinksForConnectionPoint(fragmentBlock.rgba)[0].dispose();
                } else if (pointB.name === "rgba" && fragmentBlock.rgb.isConnected) {
                    nodeB.getLinksForConnectionPoint(fragmentBlock.rgb)[0].dispose();
                }                     
            }
        } else {
            let message = "";

            switch (compatibilityState) {
                case NodeMaterialConnectionPointCompatibilityStates.TypeIncompatible:
                    message = "Cannot connect two different connection types";
                    break;
                case NodeMaterialConnectionPointCompatibilityStates.TargetIncompatible:
                    message = "Source block can only work in fragment shader whereas destination block is currently aimed for the vertex shader";
                    break;
            }

            this.props.globalState.onErrorMessageDialogRequiredObservable.notifyObservers(message);             
            return;
        }

        if (pointB.isConnected) {
            let links = nodeB.getLinksForConnectionPoint(pointB);

            links.forEach(link => {
                link.dispose();
            });
        }

        pointA.connectTo(pointB);
        this.connectPorts(pointA, pointB);

        nodeB.refresh();

        this.props.globalState.onRebuildRequiredObservable.notifyObservers();
    }
 
    render() {
        return (
            <div id="graph-canvas" 
                onWheel={evt => this.onWheel(evt)}
                onPointerMove={evt => this.onMove(evt)}
                onPointerDown={evt =>  this.onDown(evt)}   
                onPointerUp={evt =>  this.onUp(evt)}   
            >    
                <div id="graph-container">
                    <div id="graph-canvas-container">
                    </div>     
                    <svg id="graph-svg-container">
                    </svg>
                </div>
            </div>
        );
    }
}
