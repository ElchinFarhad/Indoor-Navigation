import React, { Component, useEffect, useState } from 'react';
import graphDb from '../db/graph.json'


const Graph=()=> {

  const [c1, setVertex] =  useState(0);
  const [distValue, setSelectedValue] = useState([]);
  
  useEffect(() => {
    initalizeArray();
  }, []); 

  let graphJson=JSON.parse(JSON.stringify(graphDb));
  let r=graphJson.nodes.length;
  let graph: number[][]=[[r][r]];

  // var result:number[]= [0,1,3]
  
  var qrCodeId=0;
  var res=1;


  for(let i=0; i<r; i++){
    let x=graphJson.nodes[i]
  }

  let xStart=graphJson.nodes.find(item => item.id === qrCodeId)
  let yStart= graphJson.nodes.find(item => item.id === qrCodeId)

  let xNext=graphJson.nodes.x.find(item => item.id === res)
  let yNext= graphJson.nodes.y.find(item => item.id === res)



  const initalizeArray = () => {
    graph=Array.from({ length: r}, () => (
      Array.from({ length: r }, ()=> 0)
      
   ))

    for(let i=0; i<r; i++){
      let adjacentNodes=graphJson.nodes[i].path
      for(let j=0; j<adjacentNodes.length; j++){
        if(adjacentNodes[j].nodeID<r){
          graph[i][adjacentNodes[j].nodeID] = adjacentNodes[j].weight;
        }
      }
    }

    dijkstra(graph, 0);

  };



////////////  Dijkstar

function minDistance(dist,sptSet)
{
     
    // Initialize min value
    let min = Number.MAX_VALUE;
    let min_index = -1;
     
    for(let v = 0; v < r; v++)
    {
        if (sptSet[v] == false && dist[v] <= min)
        {
            min = dist[v];
            min_index = v;
        }
    }
    return min_index;
}
 
// A utility function to print
// the constructed distance array
function printSolution(dist)
{
    // document.write("Vertex \t\t Distance from Source<br>");
    for(let i = 0; i < r; i++)
    {
        // document.write(i + " \t\t " +
        //          dist[i] + "<br>");
                 setSelectedValue(dist[i])
        // console.log(i," ", dist[i])
        // console.log(xNext, xStart, yNext, yStart);

    }

    console.log("hello guys", distValue)
}
 
// Function that implements Dijkstra's
// single source shortest path algorithm
// for a graph represented using adjacency
// matrix representation
function dijkstra(graph, src)
{
    let dist = new Array(r);
    let sptSet = new Array(r);
     
    // Initialize all distances as
    // INFINITE and stpSet[] as false
    for(let i = 0; i < r; i++)
    {
        dist[i] = Number.MAX_VALUE;
        sptSet[i] = false;
    }
     
    // Distance of source vertex
    // from itself is always 0
    dist[src] = 0;
     
    // Find shortest path for all vertices
    for(let count = 0; count < r - 1; count++)
    {
         
        // Pick the minimum distance vertex
        // from the set of vertices not yet
        // processed. u is always equal to
        // src in first iteration.
        let u = minDistance(dist, sptSet);
         
        // Mark the picked vertex as processed
        sptSet[u] = true;
         
        // Update dist value of the adjacent
        // vertices of the picked vertex.
        for(let v = 0; v < r; v++)
        {
             
            // Update dist[v] only if is not in
            // sptSet, there is an edge from u
            // to v, and total weight of path
            // from src to v through u is smaller
            // than current value of dist[v]
            if (!sptSet[v] && graph[u][v] != 0 &&
                   dist[u] != Number.MAX_VALUE &&
                   dist[u] + graph[u][v] < dist[v])
            {
                dist[v] = dist[u] + graph[u][v];
            }
        }
    }
    setSelectedValue(dist);

     
    // Print the constructed distance array
    printSolution(dist);
  }

return ( 
    <div>
    <ul>
      {/* {{distValue}} */}
      {{xStart}}
          </ul>
    </div>

  );
}

export default Graph;
