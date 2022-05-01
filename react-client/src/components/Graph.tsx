import React, { Component, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import graphDb from '../db/graph.json'


const Graph=()=> {

  const [c1, setVertex] =  useState(0);
  const [distValue, setSelectedValue] = useState([]);
  const [nextDest, setNextDest] =  useState(0);

  useEffect(() => {
    initalizeArray();
  }, []); 

  let graphJson=JSON.parse(JSON.stringify(graphDb));
  let r=graphJson.nodes.length;
  let graph: number[][]=[[r][r]];

  var result:number[]= [0,1,3]

  setNextDest(result[1]);

  let roomId  = useParams()

  console.log(roomId);
  var qrCodeId=0;

  for(let i=0; i<r; i++){
    let x=graphJson.nodes[i]
  }

  
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
    // [0,2,3]
    // arr[1].x
    // arr[1].y

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

function printSolution(dist)
{
  for(let i = 0; i < r; i++)
    {
      setSelectedValue(dist[i])


    }

    console.log("hello guys", distValue)
}
 

function dijkstra(graph, src)
{
    let dist = new Array(r);
    let sptSet = new Array(r);
     
    for(let i = 0; i < r; i++)
    {
        dist[i] = Number.MAX_VALUE;
        sptSet[i] = false;
    }
     
    dist[src] = 0;
     
    for(let count = 0; count < r - 1; count++)
    {

        let u = minDistance(dist, sptSet);
         
        sptSet[u] = true;
         
        for(let v = 0; v < r; v++)
        {
             
            if (!sptSet[v] && graph[u][v] != 0 &&
                   dist[u] != Number.MAX_VALUE &&
                   dist[u] + graph[u][v] < dist[v])
            {
                dist[v] = dist[u] + graph[u][v];
            }
        }
    }
    setSelectedValue(dist);

    printSolution(dist);
  }

return ( 
    <div>
    <ul>     
          </ul>
    </div>

  );
}

export default Graph;
