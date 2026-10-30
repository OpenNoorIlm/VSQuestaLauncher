module gamma_tb;
    logic clk = 0;
    logic rst_n = 0;
    always #5 clk = ~clk;
    initial begin
        #20 rst_n = 1;
        #100 $finish;
    end
endmodule
