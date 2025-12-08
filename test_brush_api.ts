import { AffineClient } from './src/client/index.js';

async function testBrushAPI() {
  const client = new AffineClient({
    baseUrl: 'https://affine.robotsinlove.be'
  });

  await client.signIn(
    process.env.AFFINE_EMAIL!,
    process.env.AFFINE_PASSWORD!
  );
  await client.connectSocket();

  const workspaceId = '65581777-b884-4a3c-af69-f286827e90b0';
  const docId = 'ZiL1hsEIgEeJsjqXr_Qdr'; // Test-SketchAPI

  console.log('📍 Récupération des éléments Edgeless...\n');

  const elements = await client.getEdgelessElements(workspaceId, docId);

  console.log(`✅ Total éléments: ${elements.length}\n`);

  // Filtrer par type
  const byType = elements.reduce((acc, el) => {
    const type = el.type as string || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('📊 Éléments par type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // Afficher un brush en détail
  const brushElements = elements.filter(el => el.type === 'brush');

  if (brushElements.length > 0) {
    console.log('\n🎨 Exemple de brush element:');
    const brush = brushElements[0];
    console.log(JSON.stringify({
      id: brush.id,
      type: brush.type,
      lineWidth: brush.lineWidth,
      color: brush.color,
      pointsCount: Array.isArray(brush.points) ? (brush.points as unknown[]).length : 0,
      xywh: brush.xywh,
      rotate: brush.rotate
    }, null, 2));

    // Afficher quelques points
    if (Array.isArray(brush.points) && brush.points.length > 0) {
      console.log('\n📍 Premiers points (x, y, pressure):');
      const points = brush.points as number[][];
      points.slice(0, 5).forEach((point, i) => {
        const x = point[0].toFixed(2);
        const y = point[1].toFixed(2);
        const p = point[2].toFixed(3);
        console.log(`  ${i}: [${x}, ${y}, ${p}]`);
      });
    }
  } else {
    console.log('\n⚠️  Aucun brush element trouvé');
  }

  await client.disconnect();
}

testBrushAPI().catch(console.error);
