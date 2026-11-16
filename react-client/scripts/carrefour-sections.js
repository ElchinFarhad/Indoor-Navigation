/**
 * The shelf sections of the food hall of the Carrefour Montesson venue, in
 * aisle order (four per aisle: left rear, left front, right rear, right front),
 * each with the Open Food Facts categories its products are taken from.
 *
 * Which category stands in which aisle is NOT public information: this
 * assignment is a plausible one, made for testing (see docs/REAL-DATA.md).
 */
const S = (id, name, kind, ...categories) => ({ id, name, kind, categories });

module.exports = [
  // aisle 1
  S('fruits', 'Fruit', 'produce', 'fresh-fruits', 'fruits'),
  S('vegetables', 'Vegetables', 'produce', 'fresh-vegetables', 'vegetables'),
  S('juices', 'Fruit juices', 'drinks', 'fruit-juices'),
  S('nuts', 'Nuts & dried fruit', 'snacks', 'nuts', 'dried-fruits'),
  // aisle 2
  S('breads', 'Bread', 'bakery', 'breads'),
  S('viennoiseries', 'Pastries & brioches', 'bakery', 'viennoiseries', 'brioches'),
  S('biscuits', 'Biscuits', 'snacks', 'biscuits'),
  S('cakes', 'Cakes', 'snacks', 'cakes'),
  // aisle 3
  S('cereals', 'Breakfast cereals', 'pantry', 'breakfast-cereals'),
  S('jams', 'Jams', 'pantry', 'jams'),
  S('honeys', 'Honey', 'pantry', 'honeys'),
  S('spreads', 'Chocolate spreads', 'pantry', 'hazelnut-spreads', 'sweet-spreads'),
  // aisle 4
  S('coffees', 'Coffee', 'pantry', 'coffees'),
  S('teas', 'Tea & infusions', 'pantry', 'teas', 'herbal-teas'),
  S('chocolates', 'Chocolate', 'snacks', 'chocolates'),
  S('candies', 'Sweets', 'snacks', 'candies', 'confectioneries'),
  // aisle 5
  S('pastas', 'Pasta', 'pantry', 'pastas'),
  S('rices', 'Rice', 'pantry', 'rices'),
  S('canned-vegetables', 'Canned vegetables', 'pantry', 'canned-vegetables'),
  S('canned-fish', 'Canned fish', 'pantry', 'canned-fishes'),
  // aisle 6
  S('oils', 'Oils', 'pantry', 'olive-oils', 'vegetable-oils'),
  S('sauces', 'Sauces', 'pantry', 'sauces'),
  S('soups', 'Soups', 'pantry', 'soups'),
  S('condiments', 'Mustard & condiments', 'pantry', 'mustards', 'condiments'),
  // aisle 7
  S('flours', 'Flour & baking', 'pantry', 'flours'),
  S('sugars', 'Sugar', 'pantry', 'sugars'),
  S('crisps', 'Crisps', 'snacks', 'crisps', 'chips-and-fries'),
  S('aperitif', 'Aperitif snacks', 'snacks', 'appetizers', 'salty-snacks'),
  // aisle 8
  S('waters', 'Water', 'drinks', 'waters'),
  S('sodas', 'Soft drinks', 'drinks', 'sodas'),
  S('beers', 'Beer', 'drinks', 'beers'),
  S('wines', 'Wine', 'drinks', 'wines'),
  // aisle 9
  S('milks', 'Milk', 'dairy', 'milks'),
  S('yogurts', 'Yoghurt', 'dairy', 'yogurts'),
  S('butters', 'Butter', 'dairy', 'butters'),
  S('creams', 'Cream', 'dairy', 'creams'),
  // aisle 10
  S('cheeses', 'Cheese', 'dairy', 'cheeses'),
  S('eggs', 'Eggs', 'dairy', 'eggs'),
  S('desserts', 'Dairy desserts', 'dairy', 'dairy-desserts', 'desserts'),
  S('plant-milks', 'Plant-based drinks', 'dairy', 'plant-based-milk-alternatives', 'plant-based-beverages'),
  // aisle 11
  S('hams', 'Ham', 'meat', 'hams'),
  S('sausages', 'Sausages', 'meat', 'sausages'),
  S('poultry', 'Poultry', 'meat', 'poultries', 'chickens'),
  S('seafood', 'Smoked fish & seafood', 'fish', 'smoked-salmons', 'seafood'),
  // aisle 12
  S('frozen-pizzas', 'Pizzas', 'frozen', 'pizzas'),
  S('frozen-vegetables', 'Frozen vegetables', 'frozen', 'frozen-vegetables'),
  S('ice-creams', 'Ice cream', 'frozen', 'ice-creams'),
  S('frozen-meals', 'Frozen meals', 'frozen', 'frozen-ready-made-meals', 'frozen-foods'),
  // aisle 13
  S('baby', 'Baby food', 'care', 'baby-foods'),
  S('compotes', 'Compotes', 'pantry', 'compotes'),
  S('syrups', 'Syrups', 'drinks', 'syrups'),
  S('sandwiches', 'Sandwiches', 'bakery', 'sandwiches'),
  // aisle 14
  S('meals', 'Ready meals', 'pantry', 'prepared-meals', 'meals'),
  S('quiches', 'Quiches & savoury pies', 'bakery', 'quiches', 'pizzas-pies-and-quiches'),
  S('dips', 'Dips & spreads', 'pantry', 'hummus', 'salted-spreads'),
  S('vegetarian', 'Vegetarian', 'produce', 'meat-analogues', 'tofu'),
];
