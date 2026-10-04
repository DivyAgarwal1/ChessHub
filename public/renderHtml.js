'use strict';

export const renderUI = function(squares) {
    const mainContainer = document.querySelector('.main-container');
    mainContainer.innerHTML = ""; 

    squares.forEach(rankRow => {
        const rank = document.createElement("div");
        rank.classList.add('rank-style');
        mainContainer.appendChild(rank);
        
        rankRow.forEach(el => {
            const square = document.createElement('div');
            square.setAttribute("id", el.id);
            square.classList.add(`color-${el.color}`, 'square-common'); 
            
            if (el.piece) {
                const img = document.createElement('img');
                img.src = `./images/pieces/${el.piece.color}/${el.piece.type}.png`;
                img.alt = `${el.piece.color} ${el.piece.type}`;
                
                const pieceWrapper = document.createElement('div');
                pieceWrapper.classList.add(`${el.piece.type}Compo`);
                pieceWrapper.appendChild(img);
                
                square.appendChild(pieceWrapper);
            }
            rank.appendChild(square);
        });
    });
};