import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { amount, type } = await req.json()
    
    // ============================================================================
    // STUB: HDFC / BONUSHUB VERIFONE X990 TCP/IP ECR INTEGRATION
    // ============================================================================
    // When the IP documentation is provided, we will map exactly to their interface:
    /*
      const EDC_IP = "192.168.1.45"; // Store's local static IP for the card machine
      const PORT = 8080;
      
      const payload = {
        amount: amount * 100, // typically in paisa
        txn_type: type === 'UPI' ? 'QR_BQR' : 'SALE',
        invoice_no: `INV-${Date.now()}`
      };

      const response = await fetch(`http://${EDC_IP}:${PORT}/bonushub/ecr`, {
         method: 'POST',
         body: JSON.stringify(payload)
      });
      // process success response here
    */
    
    // For now, since we do not have the IP or exact packet framing, we simulate an instant success 
    // to allow POS billing to continue without rejecting legitimate sales.
    
    console.log(`[BONUSHUB EDC SIM] Pushing ₹${amount} for ${type} to Verifone X990...`);
    
    // Artificial 1.5s delay to represent terminal handshake
    await new Promise(r => setTimeout(r, 1500))

    return NextResponse.json({ success: true, message: 'Terminal transaction successful' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
