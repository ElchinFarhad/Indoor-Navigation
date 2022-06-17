
import graphDb from './graph.json'


export function shortestPathF(sourceID: number, destinationID: number) {


    let a = JSON.parse(JSON.stringify(graphDb));

    let nodesCount = a.nodes.length;

    let graph: number[][] = [[nodesCount][nodesCount]];

    graph = Array.from({ length: nodesCount }, () => (
        Array.from({ length: nodesCount }, () => 0)
    ))

    for (let i = 0; i < nodesCount; i++) {
        let adjacentNodes = a.nodes[i].path
        for (let j = 0; j < adjacentNodes.length; j++) {
            if (adjacentNodes[j].nodeID < nodesCount) {
                graph[i][adjacentNodes[j].nodeID] = adjacentNodes[j].weight;
            }
        }
    }


    let NO_PARENT = -1;
    let shortestPathArray = [];

    function dijkstra(adjacencyMatrix, startVertex) {
        let nVertices = adjacencyMatrix[0].length;

        // shortestDistances[i] will hold the
        // shortest distance from src to i
        let shortestDistances = new Array(nVertices);

        // added[i] will true if vertex i is
        // included / in shortest path tree
        // or shortest distance from src to
        // i is finalized
        let added = new Array(nVertices);

        // Initialize all distances as
        // INFINITE and added[] as false
        for (let vertexIndex = 0; vertexIndex < nVertices;
            vertexIndex++) {
            shortestDistances[vertexIndex] = Number.MAX_VALUE;
            added[vertexIndex] = false;
        }

        // Distance of source vertex from
        // itself is always 0
        shortestDistances[startVertex] = 0;

        // Parent array to store shortest
        // path tree
        let parents = new Array(nVertices);

        // The starting vertex does not
        // have a parent
        parents[startVertex] = NO_PARENT;

        // Find shortest path for all
        // vertices
        for (let i = 1; i < nVertices; i++) {

            // Pick the minimum distance vertex
            // from the set of vertices not yet
            // processed. nearestVertex is
            // always equal to startNode in
            // first iteration.
            let nearestVertex = -1;
            let shortestDistance = Number.MAX_VALUE;
            for (let vertexIndex = 0;
                vertexIndex < nVertices;
                vertexIndex++) {
                if (!added[vertexIndex] &&
                    shortestDistances[vertexIndex] <
                    shortestDistance) {
                    nearestVertex = vertexIndex;
                    shortestDistance = shortestDistances[vertexIndex];
                }
            }

            // Mark the picked vertex as
            // processed
            added[nearestVertex] = true;

            // Update dist value of the
            // adjacent vertices of the
            // picked vertex.
            for (let vertexIndex = 0;
                vertexIndex < nVertices;
                vertexIndex++) {
                let edgeDistance = adjacencyMatrix[nearestVertex][vertexIndex];

                if (edgeDistance > 0
                    && ((shortestDistance + edgeDistance) <
                        shortestDistances[vertexIndex])) {
                    parents[vertexIndex] = nearestVertex;
                    shortestDistances[vertexIndex] = shortestDistance +
                        edgeDistance;
                }
            }
        }

        printPath(destinationID, parents);

    }

    function printPath(currentVertex, parents) {

        if (currentVertex == NO_PARENT) {
            return;
        }
        printPath(parents[currentVertex], parents);

        shortestPathArray.push(currentVertex);
    }



    dijkstra(graph, sourceID);

    let res = shortestPathArray[1]; // 2 or 3

    let nextNodeX = graphDb.nodes[res].x;
    let nextNodeY = graphDb.nodes[res].y;

    let nextNodeCoordinates = {
        nextNodeX: nextNodeX,
        nextNodeY: nextNodeY,
        shortestPathArray: shortestPathArray
    }
    return nextNodeCoordinates;
}