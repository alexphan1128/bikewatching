// Lab 7: Bikewatching
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoiYWhwMDA5IiwiYSI6ImNtd2czeGliYjA0NXgyeXBuZmZ6ajBkZHYifQ.N8yAtMZcecqzBp7bNWMWhw';

// ---------- Step 1: create the map ----------
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Shared bike-lane styling (Step 2.2 / 2.3)
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

// ---------- Global helpers ----------

// Station JSON uses lon/lat (fall back to Long/Lat just in case)
function getCoords(station) {
  const point = new mapboxgl.LngLat(+(station.lon ?? station.Long), +(station.lat ?? station.Lat));
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: bucket trips by minute of day for fast filtering
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Return all trips within 60 minutes of `minute`, wrapping around midnight
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    // Window crosses midnight
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Step 4.2 + 5.3: add arrivals / departures / totalTraffic to each station
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 6.1: quantize departure ratio into 3 colors (arrivals / balanced / departures)
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function departureRatio(d) {
  return d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
}

// ---------- Everything that needs the map loaded ----------
map.on('load', async () => {
  // Step 2: bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Step 3.1: station data
  let jsonData;
  try {
    jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // Step 4.1 + 5.4: trip data, parsed and bucketed by minute
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);

      return trip;
    },
  );
  console.log('Loaded trips:', trips.length);

  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations with traffic:', stations);

  // Step 4.3: square-root scale so circle AREA tracks traffic
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Step 3.3: circles on the SVG overlay
  const svg = d3.select('#map').select('svg');
  const tooltip = document.getElementById('tooltip');

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) => departureRatio(d))
    // Step 4.4: tooltip (custom HTML tooltip so it shows instantly on hover)
    .on('mouseenter mousemove', (event, d) => {
      tooltip.hidden = false;
      tooltip.innerHTML =
        `<strong>${d.name}</strong><br>` +
        `${d.totalTraffic} trips<br>` +
        `${d.departures} departures · ${d.arrivals} arrivals`;
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY + 14}px`;
    })
    .on('mouseleave', () => {
      tooltip.hidden = true;
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Step 5.2: slider
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Bigger range when filtered, so smaller hourly counts stay visible
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => departureRatio(d));
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
